// Background Window — hidden audio window for Vosk wake word detection.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('../../lib/logger');
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
        logger.error(`[Background] Failed to load: ${desc} (${code})`);
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
        logger.error('[Background] Wake word models not found, skipping detection');
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
        logger.info(`[Background] Wake word detected ("${wakeWord}"), opening voice window`);
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
        logger.info('[Background] Audio window ready');
    });

    ipcMain.on('get-model-paths', async (event) => {
        const modelTarGzPath = wakeWordService.getModelTarGzPath();

        if (!modelTarGzPath || !fs.existsSync(modelTarGzPath)) {
            const errMsg = `Model file not found: ${modelTarGzPath}`;
            logger.error(`[Background] ${errMsg}`);
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
            logger.error(`[Background] Model server failed: ${err.message}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('model-path-error', { error: err.message });
            }
        }
    });

    ipcMain.on('console-log', (event, msg) => {
        logger.info(`[BackgroundAudio] ${msg}`);
    });

    ipcMain.on('console-error', (event, msg) => {
        logger.error(`[BackgroundAudio] ${msg}`);
    });

    ipcMain.on('resume-failed', () => {
        logger.error('[Background] Wake word detection failed to resume - mic may be in use');
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
