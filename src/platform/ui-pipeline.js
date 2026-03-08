// UI Pipeline — dispatches dynamic UI events to renderer windows.
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



module.exports = {
    dispatchFromResults,
    dispatchUiBlocks,
};
