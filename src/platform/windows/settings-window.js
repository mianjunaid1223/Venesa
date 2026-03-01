/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Settings Window
 *  Creates and manages the dedicated settings BrowserWindow.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: electron, path
 *  USED BY:    platform/main.js
 * ═══════════════════════════════════════════════════════════════
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');

let settingsWindow = null;

function create() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return settingsWindow;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    settingsWindow = new BrowserWindow({
        width: 720,
        height: 520,
        minWidth: 600,
        minHeight: 450,
        x: Math.round((screenWidth - 720) / 2),
        y: Math.round((screenHeight - 520) / 2),
        frame: true,
        resizable: true,
        transparent: false,
        backgroundColor: '#00000000',
        backgroundMaterial: 'acrylic',
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#00000000',
            symbolColor: '#ffffffff',
            height: 26,
        },
        show: false,
        skipTaskbar: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload/settings.preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    settingsWindow.loadFile(path.join(__dirname, '../../renderer/settings.window.html'))
        .catch(err => {
            console.error(`[SettingsWindow] Failed to load settings HTML: ${err.message}`);
        });

    settingsWindow.once('ready-to-show', () => {
        settingsWindow.show();
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });

    return settingsWindow;
}

function get() {
    return settingsWindow;
}

function toggle() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
    } else {
        create();
    }
}

module.exports = { create, get, toggle };
