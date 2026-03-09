// IPC Query Handlers — handles text-based queries from the renderer.
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
                    (r) => r.returnType === 'data' && (r.result !== undefined || r.error),
                );
                if (dataResults.length > 0) {
                    try {
                        const resultContext = dataResults
                            .map((r) => {
                                if (r.error) {
                                    return `[FAILED ${r.actionName}: ${r.error}]`;
                                }
                                const raw = r.result;
                                if (raw && typeof raw === 'object' && raw.success === false) {
                                    return `[FAILED ${r.actionName}: ${raw.error || 'Unknown error'}]`;
                                }
                                return `[RESULT for ${r.actionName}: ${JSON.stringify(r.result)}]`;
                            })
                            .join('\n');
                        const verbalizeQuery = `${resultContext}
The user asked: "${query}"

Present this data naturally. Rules:
- If some results FAILED and others SUCCEEDED, present the successful ones and note which ones could not be retrieved naturally.
- If ALL results failed, say so naturally in one sentence without technical detail.
- If the data is clearer as a table or visual (e.g. comparisons, rankings, multi-column data), render it inside a [ui]...[/ui] block with proper markdown.
- Keep the spoken/written summary concise.
- Do NOT emit new [action:] tags.`;
                        const verbalRaw = await llm.sendQuery(verbalizeQuery, null, 'text');
                        // Only extract speak/ui blocks — never execute actions from verbalization response
                        const verbalUiBlockMatches = [...verbalRaw.matchAll(/\[ui\]([\s\S]*?)\[\/ui\]/gi)];
                        const verbalUiBlocks = verbalUiBlockMatches.map(m => m[1].trim()).filter(Boolean);
                        const spokenResult = verbalRaw
                            .replace(/\[action:[^\]]*\]/gi, '')
                            .replace(/\[plan\][\s\S]*?\[\/plan\]/gi, '')
                            .replace(/\[step:[^\]]*\]/gi, '')
                            .replace(/\[silent\][\s\S]*?\[\/silent\]/gi, '')
                            .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, '$1')
                            .replace(/\[ui\][\s\S]*?\[\/ui\]/gi, '')
                            .trim();
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

            // If any result failed due to a missing env key, notify the renderer
            // so it can show a targeted "add key" prompt in the UI.
            if (results && results.length > 0) {
                const missingKey = results.find(r => r.envKey);
                if (missingKey) {
                    const missingKeyMsg = `To use this capability, add the key '${missingKey.envKey}' in Settings → Custom Keys, then try again.`;
                    if (textResponse === 'Done.') {
                        textResponse = missingKeyMsg;
                    }
                    if (event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('require-env-key', {
                            key: missingKey.envKey,
                            capability: missingKey.actionName,
                        });
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
            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('gemini-response', 'Something went wrong. Try again.');
            }
        }
    });
}

module.exports = { register };
