/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: UI Pipeline
 *  Single entry point for dispatching dynamic UI events to renderer
 *  windows. Both text mode and voice mode route through here.
 * ═══════════════════════════════════════════════════════════════
 *  USED BY: platform/ipc/query-handlers, platform/ipc/voice-handlers
 * ═══════════════════════════════════════════════════════════════
 *
 *  Dynamic UI payload schema:
 *  {
 *    component: string,   // 'key-value' | 'table' | 'card-list' | 'commandList'
 *    data: any,           // result data from the skill handler
 *    actionName: string,  // the skill that produced this data
 *  }
 */

const logger = require('../lib/logger');

/**
 * Normalize a plugin/skill result.
 * Handlers often return {success, message, data: [...]} wrappers.
 * Unwrap to the actual payload the renderer expects.
 */
function normalizeResult(raw) {
    if (raw === null || raw === undefined) return raw;
    if (typeof raw !== 'object' || Array.isArray(raw)) return raw;

    // Common wrapper patterns: {data}, {result}, {items}, {rows}, {list}
    for (const key of ['data', 'result', 'items', 'rows', 'list', 'processes', 'apps', 'files']) {
        if (raw[key] !== undefined && raw[key] !== null) {
            // Only unwrap if the top-level object isn't directly renderable as kv
            if (Array.isArray(raw[key]) || typeof raw[key] === 'object') {
                return raw[key];
            }
        }
    }
    return raw;
}

/**
 * Send a dynamic-ui event to a specific BrowserWindow.
 * @param {import('electron').BrowserWindow} win
 * @param {string} component
 * @param {*} data
 * @param {string} actionName
 */
function send(win, component, data, actionName) {
    if (!win || win.isDestroyed()) return;
    try {
        win.webContents.send('dynamic-ui', { component, data, actionName });
    } catch (e) {
        logger.error(`[ui-pipeline] Failed to send dynamic-ui (${component}): ${e.message}`);
    }
}

/**
 * Iterate over a processor result set and dispatch any UI-bearing results
 * to the given window. Returns true if any UI was dispatched.
 * @param {import('electron').BrowserWindow} win
 * @param {Array} results - from processor.processResponse()
 * @param {string|null} uiDirective - [ui:] tag from LLM response
 * @returns {boolean}
 */
function dispatchFromResults(win, results, uiDirective) {
    if (!results || results.length === 0) return false;
    for (const res of results) {
        const component = uiDirective || res.ui;
        if (component && res.result !== undefined && res.result !== null) {
            send(win, component, normalizeResult(res.result), res.actionName);
            return true;
        }
    }
    return false;
}

module.exports = { send, dispatchFromResults, normalizeResult };

