/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Processor
 *  Parses LLM responses — extracts [action:] tags and [plan] blocks,
 *  dispatches to skills, returns structured results.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: skills/registry, brain/orchestrator
 *  USED BY:    platform/ipc/query-handlers, platform/ipc/voice-handlers
 * ═══════════════════════════════════════════════════════════════
 */

const registry = require('../skills/registry');
const orchestrator = require('./orchestrator');

// Boot skills on first require
require('../skills/loader');

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

async function processResponse(response) {
    // 1. Extract [speak] block if present
    const { speakText, remainder, hasSpeak } = extractSpeakBlock(response);

    // 2. Unwrap [silent] blocks so actions inside them are parseable
    const actionableText = unwrapSilentBlocks(remainder);

    // 3. Extract [ui: <component>] directive if present
    let uiDirective = null;
    let textForParsing = actionableText;
    const uiMatch = textForParsing.match(/\[ui:\s*([\w-]+)\]/i);
    if (uiMatch) {
        uiDirective = uiMatch[1].trim();
        textForParsing = textForParsing.replace(uiMatch[0], '').trim();
    }

    const plan = orchestrator.parseOrchestrationPlan(textForParsing);

    if (plan?.steps?.length > 0) {
        // Compute cleanResponse: if [speak] was present, use that; otherwise strip tags from original
        let cleanResponse;
        if (hasSpeak) {
            cleanResponse = speakText;
        } else {
            cleanResponse = response
                .replace(/\[action:[^\]]*\]/gi, '')
                .replace(/\[plan\](.|[\n\r])*?\[\/plan\]/gi, '')
                .replace(/\[ui:[^\]]*\]/gi, '')
                .replace(/\[silent\]([\s\S]*?)\[\/silent\]/gi, '')
                .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, '$1')
                .trim();

            // If cleanResponse somehow bled the start of saveCommand, clean it further
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
        }));
        return { cleanResponse, results, uiDirective };
    }

    // Single action parsing using strict parser
    const actions = orchestrator.parseActionsStrict(textForParsing);

    let cleanResponse;
    if (hasSpeak) {
        cleanResponse = speakText;
    } else {
        cleanResponse = response
            .replace(/\[action:[^\]]*\]/gi, '')
            .replace(/\[ui:[^\]]*\]/gi, '')
            .replace(/\[silent\]([\s\S]*?)\[\/silent\]/gi, '')
            .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, '$1')
            .trim();
    }

    if (actions.length === 0) {
        return { cleanResponse, results: [], uiDirective };
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
                marker: result.marker,
                ui: result.ui || null,
            });
        } catch (error) {
            results.push({
                actionName: action.actionName,
                result: null,
                error: error.message || String(error),
                skipped: false,
                marker: action.marker || 'silently',
                ui: null,
            });
        }
    }

    return { cleanResponse, results, uiDirective };
}

// Convenience wrapper used by action-handlers
async function launchApplication(appName) {
    const skill = registry.get('launchApplication');
    if (!skill) return 'Application launch not available.';
    return await skill.handler({ appName });
}

module.exports = {
    processResponse,
    launchApplication,
};
