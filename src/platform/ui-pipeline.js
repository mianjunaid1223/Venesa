/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: UI Pipeline
 *  Dispatches dynamic UI events to renderer windows.
 *  Handles both structured skill UI and [ui] markdown blocks.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger
 *  USED BY:    platform/ipc/query-handlers, platform/ipc/voice-handlers
 * ═══════════════════════════════════════════════════════════════
 */

const { BrowserWindow } = require('electron');
const logger = require('../lib/logger');

/**
 * Dispatch structured UI from skill results.
 * Skills declare a `ui` field (table, key-value, card-list, command-list)
 * and the pipeline normalizes and sends the data to the renderer.
 */
function dispatchFromResults(senderWindow, results, uiDirective) {
    if (!results || results.length === 0) return;

    for (const res of results) {
        if (res.skipped || res.error) continue;
        if (!res.result) continue;

        // Determine UI component type
        const uiType = uiDirective || res.ui;
        if (!uiType) continue;

        // Parse result if it's a string
        let data = res.result;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch {
                // If not JSON, wrap as text
                data = { text: data };
            }
        }

        const payload = {
            component: uiType,
            actionName: res.actionName,
            data,
            returnType: res.returnType || 'data',
        };

        // Send to the requesting window
        if (senderWindow && !senderWindow.isDestroyed()) {
            if (senderWindow.send) {
                senderWindow.send('dynamic-ui', payload);
            } else if (senderWindow.webContents) {
                senderWindow.webContents.send('dynamic-ui', payload);
            }
        }
    }
}

/**
 * Dispatch [ui]...[/ui] markdown blocks to the renderer.
 * These are free-form GitHub-decoded markdown content from the AI.
 */
function dispatchUiBlocks(sender, uiBlocks) {
    if (!uiBlocks || uiBlocks.length === 0) return;

    if (sender && !sender.isDestroyed()) {
        if (sender.send) {
            sender.send('ui-blocks', uiBlocks);
        } else if (sender.webContents) {
            sender.webContents.send('ui-blocks', uiBlocks);
        }
    }
}

/**
 * Find the main window (non-voice, non-setup).
 * Falls back to the provided window if no main is found.
 */
function findMainWindow(senderWindow) {
    const windows = BrowserWindow.getAllWindows();
    const mainWin = windows.find(w =>
        !w.isDestroyed() &&
        w.getTitle() !== 'Voice' &&
        w.getTitle() !== 'Setup'
    );

    if (mainWin) {
        if (!mainWin.isVisible()) mainWin.show();
        if (mainWin.isMinimized()) mainWin.restore();
        return mainWin;
    }

    return senderWindow;
}

module.exports = {
    dispatchFromResults,
    dispatchUiBlocks,
    findMainWindow,
};
