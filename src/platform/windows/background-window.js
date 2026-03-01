/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Background Window
 *  Hidden audio window for Vosk wake word detection.
 * ═══════════════════════════════════════════════════════════════
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const wakeWordService = require('../speech/wake-word');
const modelServer = require('../model-server');

let backgroundAudioWindow = null;

function createBackgroundAudioWindow() {
    if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) return;

    backgroundAudioWindow = new BrowserWindow({
        width: 1,
        height: 1,
        show: false,
        skipTaskbar: true,
        webPreferences: {
            // Dedicated persistent session so Chromium's disk cache keeps the
            // 39 MB Vosk model tar.gz across app restarts. Without a named
            // partition the default session may be shared/cleared by other
            // windows, or affected by command-line flags from previous sessions.
            partition: 'persist:vosk-audio',
            preload: path.join(__dirname, '../preload/background.preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    backgroundAudioWindow.loadFile(
        path.join(__dirname, '../../renderer/background.window.html'),
    );

    backgroundAudioWindow.webContents.on('did-fail-load', (event, code, desc) => {
        console.error(`[Background] Failed to load: ${desc} (${code})`);
    });

    backgroundAudioWindow.on('close', (e) => {
        // Never let this window truly close — it keeps the app alive
        const { app } = require('electron');
        if (!app.isQuitting) e.preventDefault();
    });

    backgroundAudioWindow.on('closed', () => {
        backgroundAudioWindow = null;
    });
}

function startBackgroundWakeWordDetection(showVoiceWindow, captureScreenForVoice) {
    if (!wakeWordService.initialize()) {
        console.error('[Main] Wake word models not found, skipping wake word detection');
        return;
    }

    createBackgroundAudioWindow();

    ipcMain.removeAllListeners('wake-word-detected');
    ipcMain.removeAllListeners('background-audio-ready');
    ipcMain.removeAllListeners('get-model-paths');
    ipcMain.removeAllListeners('console-log');
    ipcMain.removeAllListeners('console-error');
    ipcMain.removeAllListeners('resume-failed');

    ipcMain.on('wake-word-detected', () => {
        if (typeof onWakeDetected === 'function') onWakeDetected('hey venesa');
    });

    function onWakeDetected(wakeWord) {
        console.log(`[Main] Wake word detected ("${wakeWord}"), opening voice window`);
        wakeWordService.pauseDetection();
        if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
            backgroundAudioWindow.webContents.send('pause-detection');
        }
        showVoiceWindow();
        captureScreenForVoice();
        if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
            backgroundAudioWindow.webContents.send('play-acknowledgment');
        }
    }

    wakeWordService.startDetection(onWakeDetected);

    ipcMain.on('background-audio-ready', () => {
        console.log('[Main] Background audio window ready');
    });

    ipcMain.on('get-model-paths', async (event) => {
        const modelTarGzPath = wakeWordService.getModelTarGzPath();

        if (!modelTarGzPath || !fs.existsSync(modelTarGzPath)) {
            const errMsg = `Model file not found: ${modelTarGzPath}`;
            console.error(`[Main] ${errMsg}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('model-path-error', { error: errMsg, path: modelTarGzPath });
            }
            return;
        }

        try {
            const port = await modelServer.ensureRunning(modelTarGzPath);
            const modelUrl = `http://127.0.0.1:${port}/model.tar.gz`;
            if (!event.sender.isDestroyed()) {
                event.sender.send('model-path', modelUrl);
            }
        } catch (err) {
            console.error(`[Main] Model server failed: ${err.message}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('model-path-error', { error: err.message });
            }
        }
    });

    ipcMain.on('console-log', (event, msg) => {
        console.log(`[BackgroundAudio] ${msg}`);
    });

    ipcMain.on('console-error', (event, msg) => {
        console.error(`[BackgroundAudio] ${msg}`);
    });

    ipcMain.on('resume-failed', () => {
        console.error('[Main] Wake word detection failed to resume - mic may be in use');
    });
}

function getWindow() {
    return backgroundAudioWindow;
}

module.exports = {
    createBackgroundAudioWindow,
    startBackgroundWakeWordDetection,
    getWindow,
};
