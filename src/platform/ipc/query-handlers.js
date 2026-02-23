/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: IPC Query Handlers
 *  Handles text-mode queries from the renderer.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/llm, brain/processor, platform/formatters
 *  USED BY:    platform/main
 * ═══════════════════════════════════════════════════════════════
 */

const { ipcMain, BrowserWindow } = require('electron');
const llm = require('../../brain/llm');
const processor = require('../../brain/processor');
const { formatForText } = require('../formatters');
const uiPipeline = require('../ui-pipeline');

function register() {
    ipcMain.on('send-to-gemini', async (event, query) => {
        try {
            if (!event.sender || event.sender.isDestroyed()) return;

            const rawResponse = await llm.sendQuery(query);
            if (!event.sender || event.sender.isDestroyed()) return;

            const { cleanResponse, results, uiDirective } = await processor.processResponse(rawResponse);
            if (event.sender.isDestroyed()) return;

            let finalText = cleanResponse;
            const resultFeedback = [];

            if (results && results.length > 0) {
                for (const res of results) {
                    if (event.sender.isDestroyed()) break;
                    const fb = formatForText(res);
                    if (fb) resultFeedback.push(fb);
                }
            }

            if (resultFeedback.length > 0) {
                finalText = (finalText + ' ' + resultFeedback.join(' ')).trim();
            }

            if (!event.sender.isDestroyed()) {
                event.sender.send('gemini-response', finalText);
                const win = BrowserWindow.fromWebContents(event.sender);
                if (win) {
                    uiPipeline.dispatchFromResults(win, results, uiDirective);
                }

                // Also forward raw action-result for non-UI results
                if (results && results.length > 0) {
                    for (const res of results) {
                        if (event.sender.isDestroyed()) break;
                        const component = uiDirective || res.ui;
                        if (!component) {
                            if (res.result) event.sender.send('action-result', res.result);
                            else if (res.error) event.sender.send('action-result', `Error: ${res.error}`);
                        }
                    }
                }
            }
        } catch (error) {
            if (!event.sender || event.sender.isDestroyed()) return;
            const safeMessage = error && error.message ? error.message : String(error);
            event.sender.send('gemini-response', `Error: ${safeMessage}`);
        }
    });

    ipcMain.on('perform-action', async (event, action) => {
        if (event.sender.isDestroyed()) return;
        try {
            if (!action || typeof action !== 'object') {
                throw new Error('Invalid action payload');
            }
            const safeParams = Object.entries(action.params || {}).map(([k, v]) => {
                const safeKey = String(k).replace(/[\]:,]/g, '');
                return `${safeKey}: ${JSON.stringify(v)}`;
            }).join(', ');
            const safeActionName = String(action.actionName || 'unknown').replace(/[\]:,]/g, '');
            const actionStr = safeParams ? `[action: ${safeActionName}, ${safeParams}]` : `[action: ${safeActionName}]`;
            const result = await processor.processResponse(actionStr);
            if (event.sender.isDestroyed()) return;
            const output = result.results?.[0]?.result ?? result.cleanResponse;
            event.sender.send('action-result', output);
        } catch (error) {
            if (!event.sender.isDestroyed()) {
                let msg = (error && error.message) ? error.message : String(error);
                msg = msg.replace(/^Error:\s*/, '');
                event.sender.send('action-result', `Error: ${msg}`);
            }
        }
    });
}

module.exports = { register };
