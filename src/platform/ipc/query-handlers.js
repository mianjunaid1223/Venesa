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
const connectivity = require('../../lib/connectivity');

const OFFLINE_MESSAGE = 'No internet connection. Please check your connection and try again.';

function register() {
    ipcMain.on('send-to-gemini', async (event, query) => {
        try {
            if (!query || typeof query !== 'string' || !query.trim()) {
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('gemini-response', 'No input received.');
                }
                return;
            }

            // Net guard — reject queries when offline
            if (!connectivity.isOnline()) {
                logger.warn('[query] Blocked: offline');
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('gemini-response', OFFLINE_MESSAGE);
                }
                return;
            }

            const rawResponse = await llm.sendQuery(query, null, 'text');
            const { cleanResponse, results, uiDirective, uiBlocks } = await processor.processResponse(rawResponse, 'text');

            // AI's response is sent directly — no formatter intermediary
            // For data-returning skills, do a second LLM pass to verbalize the result naturally.
            let textResponse = cleanResponse || 'Done.';
            let verbalUiBlocksDispatched = false;

            if (results && results.length > 0) {
                const dataResults = results.filter(
                    (r) => r.returnType === 'data' && r.result && !r.error,
                );
                if (dataResults.length > 0) {
                    try {
                        const resultContext = dataResults
                            .map((r) => `[RESULT for ${r.actionName}: ${JSON.stringify(r.result)}]`)
                            .join('\n');
                        const verbalizeQuery = `${resultContext}
The user asked: "${query}"

Present this data naturally. Rules:
- If the data is clearer as a table or visual (e.g. comparisons, rankings, multi-column data), render it inside a [ui]...[/ui] block with proper markdown.
- Keep the spoken/written summary concise.
- Do NOT emit new [action:] tags.`;
                        const verbalRaw = await llm.sendQuery(verbalizeQuery, null, 'text');
                        const { cleanResponse: spokenResult, uiBlocks: verbalUiBlocks } = await processor.processResponse(verbalRaw, 'text');
                        if (spokenResult && spokenResult.trim()) {
                            textResponse = spokenResult.trim();
                        }
                        // Dispatch any [ui] blocks produced by the verbalization pass
                        if (verbalUiBlocks && verbalUiBlocks.length > 0 && event.sender && !event.sender.isDestroyed()) {
                            uiPipeline.dispatchUiBlocks(event.sender, verbalUiBlocks);
                            verbalUiBlocksDispatched = true;
                        }
                    } catch (verbalErr) {
                        logger.warn(`[query] Verbalization pass failed: ${verbalErr.message}`);
                    }
                }
            }

            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('gemini-response', textResponse);
            }

            // Dispatch [ui] markdown blocks to renderer — skip if verbalization already dispatched UI
            if (!verbalUiBlocksDispatched && uiBlocks && uiBlocks.length > 0 && event.sender && !event.sender.isDestroyed()) {
                uiPipeline.dispatchUiBlocks(event.sender, uiBlocks);
            }

            // Dispatch structured UI from skill metadata
            if (results && results.length > 0) {
                // Route searchFiles results through action-result for same UI as spotlight
                const searchResult = results.find(r => r.actionName === 'searchFiles' && r.result && !r.error);
                if (searchResult && event.sender && !event.sender.isDestroyed()) {
                    const resultStr = typeof searchResult.result === 'string'
                        ? searchResult.result
                        : JSON.stringify(searchResult.result);
                    event.sender.send('action-result', resultStr);
                }

                // Dispatch remaining results through dynamic-ui
                const otherResults = results.filter(r => r.actionName !== 'searchFiles');
                if (otherResults.length > 0 && event.sender && !event.sender.isDestroyed()) {
                    uiPipeline.dispatchFromResults(event.sender, otherResults, uiDirective);
                }
            }

            // Silent memory operations — wrapped separately so errors don't send a duplicate response
            try {
                memory.addInteraction(query, cleanResponse, rawResponse);
            } catch (memErr) {
                logger.error(`[query] Memory write failed: ${memErr.message}`);
            }

        } catch (error) {
            logger.error(`[query] Error processing query: ${error.message}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('gemini-response', 'Something went wrong. Try again.');
            }
        }
    });
}

module.exports = { register };
