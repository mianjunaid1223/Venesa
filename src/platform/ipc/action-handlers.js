/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: IPC Action Handlers
 *  Handles file/app/URL actions from the renderer.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/processor
 *  USED BY:    platform/main
 * ═══════════════════════════════════════════════════════════════
 */

const { ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const processor = require('../../brain/processor');

const HOME_DIR = os.homedir();

function resolveAndValidatePath(filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(path.join(HOME_DIR, filePath));
    const normalized = path.normalize(resolved).toLowerCase();
    const homeNorm = path.normalize(HOME_DIR).toLowerCase();
    const homePrefix = path.normalize(HOME_DIR + path.sep).toLowerCase();

    if (normalized !== homeNorm && !normalized.startsWith(homePrefix)) {
        return null;
    }
    return resolved;
}

function register() {
    ipcMain.on('launch-app', async (event, appInfo) => {
        try {
            if (appInfo.type === 'shortcut' && appInfo.path) {
                const validPath = resolveAndValidatePath(appInfo.path);
                if (!validPath || !validPath.toLowerCase().endsWith('.lnk')) return;
                await shell.openPath(validPath);
            } else if (appInfo.appId) {
                const safeAppIdPattern = /^[a-zA-Z0-9._!\-]+$/;
                if (!safeAppIdPattern.test(appInfo.appId)) return;
                execFile('explorer.exe', [`shell:AppsFolder\\${appInfo.appId}`], { windowsHide: true }, (err) => {
                    if (err) console.error(`Failed to launch app ${appInfo.appId}:`, err);
                });
            } else {
                await processor.launchApplication(appInfo.name);
            }
        } catch (error) {
            console.error('Failed to launch app:', error);
        }
    });

    ipcMain.on('open-file', (event, filePath) => {
        const fullPath = resolveAndValidatePath(filePath);
        if (!fullPath) return;
        shell.openPath(fullPath).catch(err => console.error('open-file failed:', err));
    });

    ipcMain.on('show-file-in-folder', (event, filePath) => {
        const fullPath = resolveAndValidatePath(filePath);
        if (!fullPath) return;
        shell.showItemInFolder(fullPath);
    });

    ipcMain.on('open-folder', (event, folderPath) => {
        const fullPath = resolveAndValidatePath(folderPath);
        if (!fullPath) return;
        shell.openPath(fullPath).catch(err => console.error('open-folder failed:', err));
    });

    ipcMain.on('open-external-url', (event, url) => {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            shell.openExternal(url).catch(err => {
                console.error('open-external-url failed:', err);
            });
        }
    });
}

module.exports = { register };
