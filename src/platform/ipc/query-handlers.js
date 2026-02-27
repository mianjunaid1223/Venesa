/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: IPC Query Handlers
 *  Handles text-based queries from the renderer.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/llm, brain/processor, brain/memory
 *  USED BY:    platform/main
 * ═══════════════════════════════════════════════════════════════
 */

const { ipcMain } = require('electron');
const logger = require('../../lib/logger');
const llm = require('../../brain/llm');
const processor = require('../../brain/processor');
const memory = require('../../brain/memory');
const uiPipeline = require('../ui-pipeline');

function register() {
    ipcMain.on('send-to-gemini', async (event, query) => {
        try {
            if (!query || typeof query !== 'string' || !query.trim()) {
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('gemini-response', 'No input received.');
                }
                return;
            }

            const rawResponse = await llm.sendQuery(query, null, 'text');
            const { cleanResponse, results, uiDirective, uiBlocks } = await processor.processResponse(rawResponse, 'text');

            // AI's response is sent directly — no formatter intermediary
            if (!event.sender.isDestroyed()) {
                event.sender.send('gemini-response', cleanResponse || 'Done.');
            }

            // Dispatch [ui] markdown blocks to renderer
            if (uiBlocks && uiBlocks.length > 0) {
                uiPipeline.dispatchUiBlocks(event.sender, uiBlocks);
            }

            // Dispatch structured UI from skill metadata
            if (results && results.length > 0) {
                uiPipeline.dispatchFromResults(event.sender, results, uiDirective);
            }

            // Silent memory operations
            memory.addInteraction(query, cleanResponse);

        } catch (error) {
            logger.error(`[query] Error processing query: ${error.message}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('gemini-response', 'Something went wrong. Try again.');
            }
        }
    });
}

module.exports = { register };
