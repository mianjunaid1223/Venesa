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
    // Spotlight search — execute a skill directly by name (same pipeline AI uses)
    ipcMain.on('perform-action', async (event, payload) => {
        try {
            const { actionName, params } = payload || {};
            if (!actionName) return;

            // Ensure skills are loaded
            try { require('../../skills/loader'); } catch (e) { /* already loaded */ }
            const registry = require('../../skills/registry');

            const skill = registry.get(actionName);
            if (!skill || typeof skill.handler !== 'function') {
                console.log(`[perform-action] Skill '${actionName}' not found. Available: ${registry.getAllNames().join(', ')}`);
                if (!event.sender.isDestroyed()) {
                    event.sender.send('action-result', JSON.stringify({ notFound: true }));
                }
                return;
            }

            if (skill._enabled === false) {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('action-result', JSON.stringify({ error: `Capability '${actionName}' is disabled.` }));
                }
                return;
            }

            // Validate params against schema if present
            let validatedParams = params || {};
            if (skill.schema && typeof skill.schema.parse === 'function') {
                try {
                    validatedParams = skill.schema.parse(params || {});
                } catch (valErr) {
                    console.log(`[perform-action] Schema validation failed for '${actionName}':`, valErr.message);
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('action-result', JSON.stringify({ error: valErr.message }));
                    }
                    return;
                }
            }

            const result = await skill.handler(validatedParams);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            if (!event.sender.isDestroyed()) {
                event.sender.send('action-result', resultStr);
            }
        } catch (err) {
            console.error(`[perform-action] Error:`, err);
            if (!event.sender.isDestroyed()) {
                event.sender.send('action-result', JSON.stringify({ error: err.message }));
            }
        }
    });

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
