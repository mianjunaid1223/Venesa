// Query Pipeline — shared query-to-response logic used by both text and voice handlers.
// Single source of truth for: LLM call → process response → verbalize data → dispatch UI.
const logger = require('../../lib/logger');
const llm = require('../../brain/llm');
const processor = require('../../brain/processor');
const memory = require('../../brain/memory');
const uiPipeline = require('../ui-pipeline');
const connectivity = require('../../lib/connectivity');

const OFFLINE_MESSAGE = 'No internet connection. Please check your connection and try again.';
const RESULT_MAX_CHARS = 1500;

/**
 * Compact string representation of a tool result, truncated if needed.
 */
function summarizeResult(result) {
    if (typeof result === 'string') {
        return result.length > RESULT_MAX_CHARS
            ? result.slice(0, RESULT_MAX_CHARS) + ' … [TRUNCATED]'
            : result;
    }
    let str;
    try {
        str = JSON.stringify(result);
    } catch {
        str = String(result);
    }
    if (str.length > RESULT_MAX_CHARS) {
        return str.slice(0, RESULT_MAX_CHARS) + ' … [TRUNCATED]';
    }
    return str;
}

/**
 * Execute a full query through the LLM → processor → verbalization pipeline.
 *
 * @param {object} opts
 * @param {string} opts.query        — The user's query text
 * @param {string|null} opts.imageData — Optional base64 image for visual context
 * @param {'text'|'voice'} opts.mode  — Execution mode
 * @returns {Promise<QueryResult>}
 *
 * @typedef {object} QueryResult
 * @property {string} text           — The final response text to show/speak
 * @property {object[]} results      — Skill execution results
 * @property {string[]} uiBlocks     — Markdown UI blocks to render
 * @property {string|null} uiDirective — Structured UI directive
 * @property {boolean} shouldListen  — Whether voice mode should continue listening
 * @property {object|null} searchData — Parsed search results (for voice result selection)
 * @property {string} rawResponse    — Raw LLM output (for history logging)
 */
async function executeQuery({ query, imageData = null, mode = 'text' }) {
    // 1. Connectivity guard
    if (!connectivity.isOnline()) {
        return {
            text: OFFLINE_MESSAGE,
            results: [],
            uiBlocks: [],
            uiDirective: null,
            shouldListen: false,
            searchData: null,
            rawResponse: '',
            isOffline: true,
        };
    }

    // 2. LLM query
    const rawResponse = await llm.sendQuery(query, imageData, mode);

    // 3. Process response — parse actions, execute skills
    const { cleanResponse, results, uiDirective, uiBlocks } =
        await processor.processResponse(rawResponse, mode);

    let finalText = (cleanResponse || '').trim();
    let shouldListen = false;
    let searchData = null;
    let verbalUiBlocks = [];

    if (results && results.length > 0) {
        // Check for listen action
        for (const res of results) {
            if (res.actionName === 'listen') {
                shouldListen = true;
            }
        }

        // Check for search results
        const searchResult = results.find(
            r => r.actionName === 'searchFiles' && r.result && !r.error,
        );
        if (searchResult) {
            try {
                searchData = typeof searchResult.result === 'string'
                    ? JSON.parse(searchResult.result)
                    : searchResult.result;
            } catch (e) {
                logger.error(`[pipeline] Search parse error: ${e.message}`);
            }
        }

        // 4. Verbalization pass for data-returning skills
        const dataResults = results.filter(r =>
            (r.returnType === 'data' ||
                r.returnType === 'hybrid' ||
                (r.returnType === 'memory' && r.actionName === 'getMemory')) &&
            (r.result !== undefined || r.error),
        );

        if (dataResults.length > 0) {
            // Clear anticipatory text — only speak the verbalized data
            finalText = '';
            try {
                const resultContext = dataResults
                    .map(r => {
                        if (r.error) return `[FAILED ${r.actionName}: ${r.error}]`;
                        const raw = r.result;
                        if (raw && typeof raw === 'object' && raw.success === false) {
                            return `[FAILED ${r.actionName}: ${raw.error || 'Unknown error'}]`;
                        }
                        return `[RESULT for ${r.actionName}: ${summarizeResult(r.result)}]`;
                    })
                    .join('\n');

                const verbalizeQuery = `${resultContext}
The user asked${mode === 'voice' ? ' (via voice)' : ''}: "${query}"

Present this data naturally. Rules:
- ${mode === 'voice' ? 'Speak conversationally in 1-2 sentences maximum.' : 'Keep the summary concise.'}
- If some results FAILED and others SUCCEEDED, present the successful ones and note which ones could not be retrieved naturally.
- If ALL results failed, say so naturally in one sentence without technical detail.
- If the data is clearer as a table or visual, ${mode === 'voice' ? 'place the formatted data inside a [ui] block inside [silent] and keep spoken text brief.' : 'follow with a [ui]...[/ui] block.'}
- ${mode === 'voice' ? 'Use [speak]...[/speak] for the spoken part and [silent][ui]...[/ui][/silent] for any visual block.' : ''}
- Do NOT emit new [action:] tags.`;

                const verbalRaw = await llm.sendQuery(verbalizeQuery, null, mode);

                // Extract speak block (voice) or clean text (text)
                const speakMatch = verbalRaw.match(/\[speak\]([\s\S]*?)\[\/speak\]/i);
                const spokenResult = speakMatch
                    ? speakMatch[1].trim()
                    : verbalRaw
                        .replace(/\[action:[^\]]*\]/gi, '')
                        .replace(/\[plan\][\s\S]*?\[\/plan\]/gi, '')
                        .replace(/\[step:[^\]]*\]/gi, '')
                        .replace(/\[silent\][\s\S]*?\[\/silent\]/gi, '')
                        .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, '$1')
                        .replace(/\[ui\][\s\S]*?\[\/ui\]/gi, '')
                        .replace(/\[\/ui\]/gi, '')
                        .trim();

                // Extract [ui] blocks from verbalization
                const verbalUiMatches = [...verbalRaw.matchAll(/\[ui\]([\s\S]*?)\[\/ui\]/gi)];
                verbalUiBlocks = verbalUiMatches.map(m => m[1].trim()).filter(Boolean);

                if (spokenResult && spokenResult.trim()) {
                    finalText = spokenResult.trim();
                }
            } catch (verbalErr) {
                logger.warn(`[pipeline] Verbalization pass failed: ${verbalErr.message}`);
                finalText = "I couldn't retrieve that information right now.";
            }
        }
    }

    if (!finalText || finalText.trim() === '') {
        finalText = 'Done.';
    }

    // 5. Log interaction to memory
    try {
        memory.addInteraction(query, finalText, rawResponse);
    } catch (memErr) {
        logger.error(`[pipeline] Memory write failed: ${memErr.message}`);
    }

    return {
        text: finalText,
        results: results || [],
        uiBlocks: [...(uiBlocks || []), ...verbalUiBlocks],
        uiDirective,
        shouldListen,
        searchData,
        rawResponse,
        isOffline: false,
    };
}

/**
 * Dispatch UI events to a renderer window based on query results.
 */
function dispatchResults(sender, queryResult) {
    if (!sender || sender.isDestroyed()) return;

    const { results, uiBlocks, uiDirective } = queryResult;

    // Dispatch [ui] markdown blocks
    if (uiBlocks && uiBlocks.length > 0) {
        uiPipeline.dispatchUiBlocks(sender, uiBlocks);
    }

    if (!results || results.length === 0) return;

    // Route searchFiles results through action-result channel
    const searchResult = results.find(
        r => r.actionName === 'searchFiles' && r.result && !r.error,
    );
    if (searchResult) {
        const resultStr = typeof searchResult.result === 'string'
            ? searchResult.result
            : JSON.stringify(searchResult.result);
        sender.send('action-result', resultStr);
    }

    // Dispatch other structured UI results
    const otherResults = results.filter(r => r.actionName !== 'searchFiles');
    if (otherResults.length > 0) {
        uiPipeline.dispatchFromResults(sender, otherResults, uiDirective);
    }

    // Check for missing env keys
    const missingKey = results.find(r => r.envKey);
    if (missingKey) {
        sender.send('require-env-key', {
            key: missingKey.envKey,
            capability: missingKey.actionName,
        });
    }
}

module.exports = { executeQuery, dispatchResults, summarizeResult };
