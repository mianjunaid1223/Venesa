/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: IPC System Handlers
 *  Settings save/load, login-item, setup flow.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/llm, platform/speech/stt
 *  USED BY:    platform/main
 * ═══════════════════════════════════════════════════════════════
 */

const { ipcMain, app } = require('electron');
const llm = require('../../brain/llm');
const settings = require('../../brain/settings');
const sttService = require('../speech/stt');
const settingsWindow = require('../windows/settings-window');
const logger = require('../../lib/logger');

function register(deps) {
    const { getSetupWindow, destroySetupWindow, createMainWindow, startWakeWord } = deps;

    // Setup flow: save API keys provided during onboarding
    ipcMain.on('set-api-keys-setup', async (event, keys) => {
        try {
            const keyStore = require('../../lib/key-store');
            if (keys.gemini) await keyStore.setKey('gemini', keys.gemini);
            if (keys.elevenlabs) await keyStore.setKey('elevenlabs', keys.elevenlabs);
        } catch (e) {
            logger.error(`set-api-keys-setup error: ${e.message}`);
        }
    });

    ipcMain.on('save-settings', async (event, patch) => {
        const success = settings.save(patch);
        if (success) {
            // Re-initialize LLM but don't block main window creation if it fails
            try {
                await llm.initializeAPI();
            } catch (e) {
                logger.error(`Init API failed: ${e.message}`);
            }

            if (patch.openAtLogin !== undefined) {
                app.setLoginItemSettings({
                    openAtLogin: patch.openAtLogin,
                    path: app.getPath('exe'),
                    args: ['--hidden'],
                });
            }

            if (!event.sender.isDestroyed()) {
                event.sender.send('settings-saved', true);
            }

            if (patch.wakeWordEnabled !== undefined) {
                if (patch.wakeWordEnabled) {
                    startWakeWord();
                    const bgWin = require('../windows/background-window').getWindow();
                    if (bgWin && !bgWin.isDestroyed()) {
                        bgWin.webContents.send('resume-detection');
                    }
                } else {
                    const bgWin = require('../windows/background-window').getWindow();
                    if (bgWin && !bgWin.isDestroyed()) {
                        bgWin.webContents.send('pause-detection');
                    }
                }
            }

            const setupWindow = getSetupWindow();
            if (setupWindow && !setupWindow.isDestroyed()) {
                createMainWindow();
                sttService.initialize();
                if (settings.get().wakeWordEnabled) {
                    startWakeWord();
                }
                destroySetupWindow();
            }
        } else {
            if (!event.sender.isDestroyed()) {
                event.sender.send('settings-saved', false);
            }
        }
    });

    ipcMain.on('get-settings', (event) => {
        event.sender.send('current-settings', settings.get());
    });

    ipcMain.on('open-settings', (event) => {
        settingsWindow.toggle();
    });

    ipcMain.on('close-settings', (event) => {
        const sw = settingsWindow.get();
        if (sw && !sw.isDestroyed()) {
            sw.close();
        }
    });

    ipcMain.handle('settings:get', async () => {
        return settings.get();
    });

    ipcMain.handle('settings:save', async (event, patch) => {
        const success = settings.save(patch);
        if (success) {
            llm.initializeAPI().catch(e => logger.error(`Init API failed: ${e.message}`));
            if (patch.wakeWordEnabled !== undefined) {
                const startWakeWord = require('../windows/background-window').startBackgroundWakeWordDetection;
                const voiceWin = require('../windows/voice-window');
                const voiceHandlers = require('./voice-handlers');
                if (patch.wakeWordEnabled) {
                    startWakeWord(voiceWin.showVoiceWindow, voiceHandlers.captureScreenForVoice);
                    const bgWin = require('../windows/background-window').getWindow();
                    if (bgWin && !bgWin.isDestroyed()) {
                        bgWin.webContents.send('resume-detection');
                    }
                } else {
                    const bgWin = require('../windows/background-window').getWindow();
                    if (bgWin && !bgWin.isDestroyed()) {
                        bgWin.webContents.send('pause-detection');
                    }
                }
            }
            return true;
        }
        throw new Error('Failed to save settings');
    });

    ipcMain.handle('get-key-status', async () => {
        const keyStore = require('../../lib/key-store');
        return await keyStore.getKeyStatus();
    });

    ipcMain.handle('test-connection', async (event, service, explicitKey) => {
        const keyStore = require('../../lib/key-store');
        // Use explicitly passed key first, fall back to stored primary key
        const key = explicitKey || await keyStore.getKey(service);
        if (!key) return { success: false, error: 'No key saved for this service' };

        try {
            if (service === 'gemini') {
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
                try {
                    const signal = AbortSignal.timeout(6000);
                    // Pass signal inside requestOptions per GoogleGenerativeAI docs or fallback
                    const result = await model.generateContent('Say OK', { signal });
                    const text = result?.response?.text();
                    return text ? { success: true } : { success: false, error: 'Empty response' };
                } catch (e) {
                    if (e.name === 'AbortError' || (e.message && e.message.includes('timeout'))) {
                        return { success: false, error: 'Request timed out' };
                    }
                    throw e;
                }
            } else if (service === 'elevenlabs') {
                const { request } = require('undici');
                const resp = await request('https://api.elevenlabs.io/v1/user', {
                    headers: { 'xi-api-key': key },
                    signal: AbortSignal.timeout(6000),
                });
                await resp.body.text();
                return resp.statusCode === 200
                    ? { success: true }
                    : { success: false, error: `Status ${resp.statusCode}` };
            }
            return { success: false, error: `Unknown service: ${service}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Append a new key as the next numbered slot (GEMINI_API_KEY, _2, _3…)
    ipcMain.handle('add-api-key', async (event, service, key) => {
        const keyStore = require('../../lib/key-store');
        await keyStore.addKey(service, key);
        const keyPool = require('../../lib/key-pool');
        keyPool.invalidate();
        return true;
    });

    // Keep set-api-key for backward compat (setup window uses it)
    ipcMain.handle('set-api-key', async (event, service, key) => {
        const keyStore = require('../../lib/key-store');
        await keyStore.setKey(service, key);
        const keyPool = require('../../lib/key-pool');
        keyPool.invalidate();
        return true;
    });

    // Remove a specific key by its env-var name (e.g. 'GEMINI_API_KEY_2')
    ipcMain.handle('remove-api-key', async (event, envVar) => {
        const keyStore = require('../../lib/key-store');
        await keyStore.removeKeyByEnvVar(envVar);
        const keyPool = require('../../lib/key-pool');
        keyPool.invalidate();
        return true;
    });

    ipcMain.handle('get-loaded-skills', async () => {
        const registry = require('../../skills/registry');
        return registry.getSkillList();
    });

    ipcMain.handle('memory:get-bucket', async (event, bucket) => {
        const memory = require('../../brain/memory');
        return memory.get(bucket) || {};
    });

    ipcMain.handle('memory:clear-bucket', async (event, bucket) => {
        const memory = require('../../brain/memory');
        return memory.clear(bucket);
    });
}

module.exports = { register };
