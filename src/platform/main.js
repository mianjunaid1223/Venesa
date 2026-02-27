/**
 * ═══════════════════════════════════════════════════════════════
 *  Venesa — Platform Entry Point
 *  Electron app lifecycle, global shortcuts, protocol, IPC wiring.
 * ═══════════════════════════════════════════════════════════════
 */

const { app, protocol, net, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');

let envPath;
if (app.isPackaged) {
    envPath = path.join(process.resourcesPath, '.env');
} else {
    envPath = path.join(__dirname, '../../.env');
}
require('dotenv').config({ path: envPath });
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-gpu-cache');
app.commandLine.appendSwitch('disable-http-cache');

const os = require('os');
const fs = require('fs');
const llm = require('../brain/llm');
const logger = require('../lib/logger');
const sttService = require('./speech/stt');

const mainWin = require('./windows/main-window');
const voiceWin = require('./windows/voice-window');
const setupWin = require('./windows/setup-window');
const backgroundWin = require('./windows/background-window');

const queryHandlers = require('./ipc/query-handlers');
const voiceHandlers = require('./ipc/voice-handlers');
const systemHandlers = require('./ipc/system-handlers');
const actionHandlers = require('./ipc/action-handlers');

function getAssetsPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets');
    }
    return path.join(__dirname, '../../assets');
}

protocol.registerSchemesAsPrivileged([{
    scheme: 'venesa-asset',
    privileges: { secure: true, supportFetchAPI: true, stream: true },
}]);

const startHidden = process.argv.includes('--hidden');

app.whenReady().then(async () => {
    protocol.handle('venesa-asset', (request) => {
        let filePath = request.url.replace('venesa-asset://', '');
        try { filePath = decodeURIComponent(filePath); } catch (e) { }

        const assetsPath = path.resolve(getAssetsPath());
        const fullPath = path.resolve(assetsPath, filePath);
        const relativePath = path.relative(assetsPath, fullPath);
        const isTraversal = relativePath === '..' ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath);

        if (isTraversal) {
            return new Response('Forbidden', { status: 403 });
        }

        return net.fetch(`file://${fullPath}`);
    });

    const settingsPath = path.join(os.homedir(), '.venesa-settings.json');
    let autoStartEnabled = false;
    try {
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            autoStartEnabled = settings.openAtLogin === true;
        }
    } catch (e) {
        logger.error(`[Main] Failed to read settings: ${e?.message ?? String(e)}`);
        autoStartEnabled = false;
    }

    app.setLoginItemSettings({
        openAtLogin: autoStartEnabled,
        path: app.getPath('exe'),
        args: autoStartEnabled ? ['--hidden'] : [],
    });

    const createMainWindow = () => {
        mainWin.createWindow(startHidden);
    };

    const showVoice = () => voiceWin.showVoiceWindow();
    const hideVoice = () => voiceWin.hideVoiceWindow();
    const getVoiceWindow = () => voiceWin.getWindow();

    const startWakeWord = () => {
        backgroundWin.startBackgroundWakeWordDetection(showVoice, voiceHandlers.captureScreenForVoice);
    };

    if (llm.needsSetup()) {
        setupWin.createSetupWindow();
    } else {
        await llm.initializeAPI();
        createMainWindow();
        sttService.initialize();
        startWakeWord();
    }

    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') return callback(true);
        callback(false);
    });

    queryHandlers.register();
    voiceHandlers.register(getVoiceWindow, hideVoice);
    systemHandlers.register({
        getSetupWindow: setupWin.getWindow,
        destroySetupWindow: setupWin.destroyWindow,
        createMainWindow,
        startWakeWord,
    });
    actionHandlers.register();

    ipcMain.on('resize-window', (event, contentHeight) => {
        mainWin.handleResize(contentHeight);
    });

    globalShortcut.register('Alt+Space', () => {
        if (llm.needsSetup()) {
            const sw = setupWin.getWindow();
            if (sw && !sw.isDestroyed()) {
                sw.show();
                sw.focus();
            } else {
                setupWin.createSetupWindow();
            }
            return;
        }

        const mw = mainWin.getWindow();
        if (!mw || mw.isDestroyed()) {
            llm.initializeAPI()
                .then(() => createMainWindow())
                .catch(e => {
                    logger.error(`[Main] initializeAPI error: ${e.message}`);
                    createMainWindow();
                });
            return;
        }

        if (mw.isVisible()) {
            mw.hide();
        } else {
            mainWin.showWindow();
        }
    });

    globalShortcut.register('Ctrl+Shift+V', async () => {
        if (llm.needsSetup()) return;
        await voiceHandlers.captureScreenForVoice();
        showVoice();
    });

    globalShortcut.register('Ctrl+,', () => {
        const settingsWindow = require('./windows/settings-window');
        settingsWindow.toggle();
    });

    globalShortcut.register('Alt+Escape', () => {
        const vw = voiceWin.getWindow();
        if (vw && !vw.isDestroyed() && vw.isVisible()) {
            hideVoice();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Only quit if the main window is also gone (not just hidden)
        const mw = mainWin.getWindow();
        if (!mw || mw.isDestroyed()) {
            app.quit();
        }
    }
});
