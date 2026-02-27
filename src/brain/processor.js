/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Processor
 *  Parses LLM responses — extracts [action:] tags, [plan] blocks,
 *  [ui] blocks, [speak]/[silent] sections. Dispatches to skills,
 *  returns structured results.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: skills/registry, brain/orchestrator
 *  USED BY:    platform/ipc/query-handlers, platform/ipc/voice-handlers
 * ═══════════════════════════════════════════════════════════════
 */

const registry = require('../skills/registry');
const orchestrator = require('./orchestrator');

// Boot skills on first require
try {
    require('../skills/loader');
} catch (e) {
    const logger = require('../lib/logger');
    logger.error(`[processor] Failed to load skills: ${e?.message ?? String(e)}`);
}

/**
 * Extract the [speak]...[/speak] block if present.
 * Returns { speakText, remainder } where remainder has the [speak] block removed.
 */
function extractSpeakBlock(response) {
    const speakMatch = response.match(/\[speak\]([\s\S]*?)\[\/speak\]/i);
    if (speakMatch) {
        const speakText = speakMatch[1].trim();
        const remainder = response.replace(speakMatch[0], '').trim();
        return { speakText, remainder, hasSpeak: true };
    }
    return { speakText: null, remainder: response, hasSpeak: false };
}

/**
 * Strip [silent]...[/silent] wrapper while preserving internal action content.
 * The actions inside [silent] still need to be parsed.
 */
function unwrapSilentBlocks(text) {
    return text
        .replace(/\[silent\]/gi, '')
        .replace(/\[\/silent\]/gi, '')
        .trim();
}

/**
 * Extract [ui]...[/ui] markdown blocks from the response.
 * Returns { uiBlocks: string[], remainder: string }
 */
function extractUiBlocks(text) {
    const uiBlocks = [];
    const regex = /\[ui\]([\s\S]*?)\[\/ui\]/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const content = match[1].trim();
        if (content) uiBlocks.push(content);
    }
    const remainder = text.replace(regex, '').trim();
    return { uiBlocks, remainder };
}

/**
 * Process an LLM response: parse tags, execute skills, return structured output.
 *
 * @param {string} response - Raw LLM response text
 * @param {string} mode - 'text' or 'voice'
 * @returns {{ cleanResponse: string, results: Array, uiDirective: string|null, uiBlocks: string[] }}
 */
async function processResponse(response, mode = 'text') {
    // 1. Extract [speak] block if present
    const { speakText, remainder, hasSpeak } = extractSpeakBlock(response);

    // 2. Unwrap [silent] blocks so actions inside them are parseable
    const actionableText = unwrapSilentBlocks(remainder);

    // 3. Extract [ui]...[/ui] markdown blocks
    const { uiBlocks, remainder: textAfterUi } = extractUiBlocks(actionableText);

    // 4. Extract legacy [ui: <component>] directive if present
    let uiDirective = null;
    let textForParsing = textAfterUi;
    const uiMatch = textForParsing.match(/\[ui:\s*([\w-]+)\]/i);
    if (uiMatch) {
        uiDirective = uiMatch[1].trim();
        textForParsing = textForParsing.replace(uiMatch[0], '').trim();
    }

    // 5. Try parsing as orchestration plan
    const plan = orchestrator.parseOrchestrationPlan(textForParsing);

    if (plan?.steps?.length > 0) {
        let cleanResponse;
        if (hasSpeak) {
            cleanResponse = speakText;
        } else {
            cleanResponse = response
                .replace(/\[action:[^\]]*\]/gi, '')
                .replace(/\[plan\](.|[\n\r])*?\[\/plan\]/gi, '')
                .replace(/\[ui:[^\]]*\]/gi, '')
                .replace(/\[ui\][\s\S]*?\[\/ui\]/gi, '')
                .replace(/\[silent\]([\s\S]*?)\[\/silent\]/gi, '')
                .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, '$1')
                .trim();

            if (cleanResponse.includes('[action:')) {
                cleanResponse = cleanResponse.split('[action:')[0].trim();
            }
        }

        const rawResults = await orchestrator.executePlan(plan);
        const results = rawResults.map(r => ({
            actionName: r.actionName,
            result: r.result !== undefined ? r.result : null,
            error: r.error || null,
            skipped: r.skipped || false,
            marker: r.marker || 'announce',
            ui: r.ui || null,
            returnType: r.returnType || 'action',
        }));
        return { cleanResponse, results, uiDirective, uiBlocks };
    }

    // 6. Single action parsing using strict parser
    const actions = orchestrator.parseActionsStrict(textForParsing);

    let cleanResponse;
    if (hasSpeak) {
        cleanResponse = speakText;
    } else {
        cleanResponse = response
            .replace(/\[action:[^\]]*\]/gi, '')
            .replace(/\[ui:[^\]]*\]/gi, '')
            .replace(/\[ui\][\s\S]*?\[\/ui\]/gi, '')
            .replace(/\[silent\]([\s\S]*?)\[\/silent\]/gi, '')
            .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, '$1')
            .trim();
    }

    if (actions.length === 0) {
        return { cleanResponse, results: [], uiDirective, uiBlocks };
    }

    const results = [];
    for (const [index, action] of actions.entries()) {
        try {
            const result = await orchestrator.executeAction(action.actionName, action.params, {
                planId: 'single',
                stepIndex: index,
                marker: action.marker
            });

            results.push({
                actionName: action.actionName,
                result: result.success ? result.output : null,
                error: result.error || null,
                skipped: false,
                marker: result.marker || 'announce',
                ui: result.ui || null,
                returnType: result.returnType || 'action',
            });
        } catch (error) {
            results.push({
                actionName: action.actionName,
                result: null,
                error: error.message || String(error),
                skipped: false,
                marker: action.marker || 'silently',
                ui: null,
                returnType: 'action',
            });
        }
    }

    return { cleanResponse, results, uiDirective, uiBlocks };
}

// Convenience wrapper used by action-handlers
async function launchApplication(appName) {
    try {
        const skill = registry.get('launchApplication');
        if (!skill) return 'Application launch not available.';
        return await skill.handler({ appName });
    } catch (e) {
        return `Application launch failed: ${e?.message ?? String(e)}`;
    }
}

module.exports = {
    processResponse,
    launchApplication,
};
