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
const path = require('path');
const llm = require('../../brain/llm');
const settings = require('../../brain/settings');
const sttService = require('../speech/stt');
const settingsWindow = require('../windows/settings-window');
const logger = require('../../lib/logger');
const memory = require('../../brain/memory');

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
                if (settings.load().wakeWordEnabled) {
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
        event.sender.send('current-settings', settings.load());
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
        return settings.load();
    });

    ipcMain.handle('settings:save', async (event, patch) => {
        const success = settings.save(patch);
        if (success) {
            llm.initializeAPI().catch(e => logger.error(`Init API failed: ${e.message}`));
            // Expire prompt cache so userName changes etc. take effect immediately
            if (llm.invalidatePromptCache) llm.invalidatePromptCache();
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

    ipcMain.handle('add-api-key', async (event, service, key) => {
        const keyStore = require('../../lib/key-store');
        await keyStore.addKey(service, key);
        const keyPool = require('../../lib/key-pool');
        keyPool.invalidate();
        return true;
    });

    ipcMain.handle('add-custom-key', async (event, envVar, key) => {
        if (!envVar || typeof envVar !== 'string') throw new Error('Invalid envVar');
        if (!key || typeof key !== 'string' || !key.trim()) throw new Error('Invalid key');

        const keyStore = require('../../lib/key-store');
        // Validate envVar (e.g. OPENWEATHER_KEY)
        const safeEnvVar = envVar.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
        if (!safeEnvVar) throw new Error('Invalid envVar after sanitization');

        await keyStore.writeKeyToEnv(safeEnvVar, key.trim());
        const keyPool = require('../../lib/key-pool');
        keyPool.invalidate();
        return true;
    });

    ipcMain.handle('get-api-key', async (event, envVar, svc) => {
        const keyStore = require('../../lib/key-store');
        if (envVar) {
            if (typeof envVar !== 'string') return null;
            const safeEnvVar = envVar.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
            if (!safeEnvVar || safeEnvVar !== envVar) return null; // reject if sanitization alters the string
            return keyStore.getKeyFromEnv(safeEnvVar);
        }
        if (svc) return keyStore.getKey(svc);
        return null;
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

    ipcMain.handle('factory-reset', async () => {
        const fs = require('fs');
        const os = require('os');
        const paths = require('../../lib/paths');

        try {
            // 1. Delete .env (all API keys)
            const envPath = paths.getEnvPath();
            if (fs.existsSync(envPath)) fs.unlinkSync(envPath);

            // 2. Delete settings
            const settingsPath = path.join(os.homedir(), '.venesa-settings.json');
            if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);

            // 3. Clear all memory
            const memory = require('../../brain/memory');
            const buckets = memory.BUCKETS || ['system', 'preferences', 'clipboard'];
            for (const b of buckets) memory.clearBucket(b);

            // 4. Invalidate key pool
            require('../../lib/key-pool').invalidate();

            return { success: true };
        } catch (e) {
            logger.error(`Factory reset failed: ${e.message}`);
            return { success: false, error: e.message };
        }
    });

    // ── Plugin management ─────────────────────────────────────

    ipcMain.handle('get-plugins', async () => {
        const registry = require('../../skills/registry');
        return registry.getAllPlugins ? registry.getAllPlugins() : [];
    });

    ipcMain.handle('get-builtin-skills', async () => {
        const registry = require('../../skills/registry');
        return registry.getBuiltinSkills ? registry.getBuiltinSkills() : registry.getSkillList();
    });

    ipcMain.handle('toggle-plugin', async (event, pluginName, enabled) => {
        try {
            // Call lifecycle hooks before state change
            const registry = require('../../skills/registry');
            const skill = registry.get(pluginName);
            if (skill?.lifecycle) {
                const hook = enabled ? skill.lifecycle.onEnable : skill.lifecycle.onDisable;
                if (typeof hook === 'function') {
                    try { await hook(); } catch (e) {
                        logger.warn(`Lifecycle ${enabled ? 'onEnable' : 'onDisable'} failed for '${pluginName}': ${e?.message ?? String(e)}`);
                    }
                }
            }

            const states = memory.get('aliases', 'pluginStates') || {};
            states[pluginName] = enabled;
            memory.set('aliases', 'pluginStates', states);
            // Reload skill registry to apply change
            const loader = require('../../skills/loader');
            loader.reload();
            if (llm.invalidatePromptCache) llm.invalidatePromptCache();
            return { success: true };
        } catch (e) {
            logger.error(`toggle-plugin error: ${e.message}`);
            return { success: false, error: e.message };
        }
    });

    // ── Memory IPC ────────────────────────────────────────────

    ipcMain.handle('memory:get-bucket', async (event, bucket) => {
        return memory.get(bucket) || {};
    });

    ipcMain.handle('memory:get-all', async () => {
        const result = {};
        if (Array.isArray(memory.BUCKETS)) {
            for (const bucket of memory.BUCKETS) {
                result[bucket] = memory.get(bucket) || {};
            }
        }
        return result;
    });

    // ── Profile IPC ───────────────────────────────────────────

    ipcMain.handle('profile:get', async () => {
        return {
            name: memory.get('context', 'name') || '',
            bio: memory.get('context', 'bio') || ''
        };
    });

    ipcMain.handle('profile:save', async (event, profile) => {
        if (profile.name !== undefined) memory.set('context', 'name', profile.name);
        if (profile.bio !== undefined) memory.set('context', 'bio', profile.bio);
        if (llm.invalidatePromptCache) llm.invalidatePromptCache();
        return true;
    });

    ipcMain.handle('memory:clear-bucket', async (event, bucket) => {
        const cleared = memory.clear(bucket);
        if (cleared && llm.invalidatePromptCache) llm.invalidatePromptCache();
        return cleared;
    });

    ipcMain.handle('memory:delete-entry', async (event, bucket, key) => {
        const removed = memory.remove(bucket, key);
        if (removed && llm.invalidatePromptCache) llm.invalidatePromptCache();
        return removed;
    });

    // ── Utility ───────────────────────────────────────────────
    ipcMain.handle('open-url', async (event, url) => {
        try {
            const { shell } = require('electron');
            if (url && typeof url === 'string' && /^https?:\/\//i.test(url)) {
                await shell.openExternal(url);
                return { success: true };
            }
            return { success: false, error: 'Invalid URL' };
        } catch (e) {
            logger.error(`open-url error: ${e.message}`);
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
