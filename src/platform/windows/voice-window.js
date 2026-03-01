/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Voice Window
 *  Full-screen voice interaction overlay.
 * ═══════════════════════════════════════════════════════════════
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const sttService = require('../speech/stt');
const wakeWordService = require('../speech/wake-word');

let voiceWindow = null;

function getBackgroundWindow() {
    const bgWindow = require('./background-window');
    return bgWindow.getWindow();
}

function createVoiceWindow() {
    if (voiceWindow && !voiceWindow.isDestroyed()) return;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    voiceWindow = new BrowserWindow({
        width: width,
        height: height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload/voice.preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    voiceWindow.loadFile(path.join(__dirname, '../../renderer/voice.window.html'));

    voiceWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[VoiceWindow] Renderer crashed:', details.reason);
        sttService.stop();
        wakeWordService.resumeDetection();
        if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.destroy();
        voiceWindow = null;
    });

    voiceWindow.webContents.on('crashed', (event, killed) => {
        console.error('[VoiceWindow] WebContents crashed, killed:', killed);
        sttService.stop();
        wakeWordService.resumeDetection();
        if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.destroy();
        voiceWindow = null;
    });

    let blurTimeout = null;

    voiceWindow.on('blur', () => {
        if (blurTimeout) clearTimeout(blurTimeout);
        blurTimeout = setTimeout(() => {
            blurTimeout = null;
            if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.isVisible()) {
                hideVoiceWindow();
            }
        }, 100);
    });

    voiceWindow.on('focus', () => {
        if (blurTimeout) {
            clearTimeout(blurTimeout);
            blurTimeout = null;
        }
    });

    voiceWindow.on('closed', () => {
        voiceWindow = null;
    });
}

function showVoiceWindow(closeAllFeatureWindows) {
    if (!voiceWindow || voiceWindow.isDestroyed()) {
        createVoiceWindow();
    }

    if (closeAllFeatureWindows) {
        closeAllFeatureWindows();
    }

    let startListeningSent = false;

    const safeSend = (channel, data) => {
        try {
            if (voiceWindow && !voiceWindow.isDestroyed() &&
                voiceWindow.webContents && !voiceWindow.webContents.isDestroyed()) {
                voiceWindow.webContents.send(channel, data);
            }
        } catch (err) { }
    };

    sttService.start((type, text) => {
        if (type === 'text') {
            safeSend('stt-result', text);
        } else if (type === 'partial') {
            safeSend('stt-partial-result', text);
        }
    });

    if (voiceWindow.webContents.isLoading()) {
        const onDidFinishLoad = () => {
            if (!voiceWindow || !voiceWindow.webContents) return;
            voiceWindow.webContents.removeListener('did-finish-load', onDidFinishLoad);
            if (!startListeningSent) {
                startListeningSent = true;
                safeSend('start-listening');
            }
        };
        voiceWindow.webContents.on('did-finish-load', onDidFinishLoad);
    } else {
        if (!startListeningSent) {
            startListeningSent = true;
            safeSend('start-listening');
        }
    }

    voiceWindow.show();
    voiceWindow.focus();
}

function hideVoiceWindow() {
    const safeSendToVoice = (channel, data) => {
        try {
            if (voiceWindow && !voiceWindow.isDestroyed() &&
                voiceWindow.webContents && !voiceWindow.webContents.isDestroyed()) {
                voiceWindow.webContents.send(channel, data);
            }
        } catch (e) { }
    };

    if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.hide();
        sttService.stop();

        safeSendToVoice('auto-close-voice');

        wakeWordService.resumeDetection();
        const backgroundAudioWindow = getBackgroundWindow();
        if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
            try {
                if (backgroundAudioWindow.webContents && !backgroundAudioWindow.webContents.isDestroyed()) {
                    backgroundAudioWindow.webContents.send('resume-detection');
                }
            } catch (e) { }
        }
    }
}

function getWindow() {
    return voiceWindow;
}

module.exports = {
    createVoiceWindow,
    showVoiceWindow,
    hideVoiceWindow,
    getWindow,
};
