/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Setup Window
 *  First-run API key entry window.
 * ═══════════════════════════════════════════════════════════════
 */

const { BrowserWindow } = require('electron');
const path = require('path');

let setupWindow = null;

function createSetupWindow() {
    if (setupWindow && !setupWindow.isDestroyed()) return setupWindow;

    setupWindow = new BrowserWindow({
        width: 460,
        height: 630,
        frame: false,
        transparent: false,
        backgroundColor: '#000000',
        backgroundMaterial: 'acrylic',
        resizable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload/main.preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    setupWindow.loadFile(path.join(__dirname, '../../renderer/setup.window.html'));
    setupWindow.center();

    setupWindow.once('ready-to-show', () => {
        setupWindow.show();
    });

    // setupWindow.on('blur', () => {
    //     if (setupWindow && !setupWindow.isDestroyed()) {
    //         setupWindow.hide();
    //     }
    // });

    setupWindow.on('close', (e) => {
        if (setupWindow && !setupWindow.isDestroyed()) {
            e.preventDefault();
            setupWindow.hide();
        }
    });

    return setupWindow;
}

function getWindow() {
    return setupWindow;
}

function destroyWindow() {
    if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.removeAllListeners('blur');
        setupWindow.removeAllListeners('close');
        setupWindow.destroy();
        setupWindow = null;
    }
}

module.exports = {
    createSetupWindow,
    getWindow,
    destroyWindow,
};
