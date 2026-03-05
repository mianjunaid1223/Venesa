/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Processor
 *  Parses LLM responses — extracts [action:] tags, [plan] blocks,
 *  [ui] blocks, [speak]/[silent] sections. Dispatches to skills,
 *  returns structured results.
 *
 *  Governance Contract v2.0:
 *    - Classifies responses by execution mode (execute/data/ui/refuse)
 *    - Tracks workflow pipeline stages engaged per response
 *    - Structured refusal detection (no hidden conversational refusals)
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: skills/registry, brain/orchestrator
 *  USED BY:    platform/ipc/query-handlers, platform/ipc/voice-handlers
 * ═══════════════════════════════════════════════════════════════
 */

const registry = require('../skills/registry');
const orchestrator = require('./orchestrator');
const { EXECUTION_MODES, WORKFLOW_STAGES } = require('./protocol');

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
 * Classify the response into an execution mode.
 * Returns one of: execute | data | ui | refuse
 */
function classifyExecutionMode(results, uiBlocks, uiDirective, cleanResponse) {
    if (results.length === 0 && uiBlocks.length === 0 && !uiDirective) {
        if (isStructuredRefusal(cleanResponse)) return EXECUTION_MODES.refuse;
        return EXECUTION_MODES.data;
    }
    if (results.length > 0 && results.every(r => r.returnType === 'data' || r.returnType === 'memory')) {
        return EXECUTION_MODES.data;
    }
    if ((uiBlocks.length > 0 || uiDirective) && results.length === 0) {
        return EXECUTION_MODES.ui;
    }
    return EXECUTION_MODES.execute;
}

/**
 * Detect whether the response is a structured refusal.
 * Matches: "Cannot <action>: <reason>." or broader refusal patterns.
 */
function isStructuredRefusal(text) {
    if (!text) return false;
    return /^cannot\s+\S.{0,120}[.:]/i.test(text.trim());
}

/**
 * Build the list of pipeline stages that were engaged in this response.
 */
function getEngagedStages(results, uiBlocks, uiDirective, mode) {
    const stages = [
        WORKFLOW_STAGES[0], // INTENT_PARSING
        WORKFLOW_STAGES[1], // FEASIBILITY_EVALUATION
        WORKFLOW_STAGES[2], // PLAN_CONSTRUCTION
    ];
    if (mode === EXECUTION_MODES.refuse) return stages;
    if (results.length > 0) stages.push(WORKFLOW_STAGES[3]); // STEP_EXECUTION
    stages.push(WORKFLOW_STAGES[4]); // RESULT_STRUCTURING
    if (uiBlocks.length > 0 || uiDirective) stages.push(WORKFLOW_STAGES[5]); // UI_RENDERING
    const hasMemoryOp = results.some(r => r.returnType === 'memory');
    if (hasMemoryOp) stages.push(WORKFLOW_STAGES[6]); // MEMORY_UPDATE
    return stages;
}

/**
 * Process an LLM response: parse tags, execute skills, return structured output.
 *
 * @param {string} response - Raw LLM response text
 * @returns {{
 *   cleanResponse: string,
 *   results: Array,
 *   uiDirective: string|null,
 *   uiBlocks: string[],
 *   executionMode: string,
 *   pipelineStages: string[],
 *   isRefusal: boolean,
 * }}
 */
async function processResponse(response) {
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
        const executionMode = classifyExecutionMode(results, uiBlocks, uiDirective, cleanResponse);
        const pipelineStages = getEngagedStages(results, uiBlocks, uiDirective, executionMode);
        return {
            cleanResponse,
            results,
            uiDirective,
            uiBlocks,
            executionMode,
            pipelineStages,
            isRefusal: false,
        };
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
        const executionMode = classifyExecutionMode([], uiBlocks, uiDirective, cleanResponse);
        const pipelineStages = getEngagedStages([], uiBlocks, uiDirective, executionMode);
        return {
            cleanResponse,
            results: [],
            uiDirective,
            uiBlocks,
            executionMode,
            pipelineStages,
            isRefusal: executionMode === EXECUTION_MODES.refuse,
        };
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

    const executionMode = classifyExecutionMode(results, uiBlocks, uiDirective, cleanResponse);
    const pipelineStages = getEngagedStages(results, uiBlocks, uiDirective, executionMode);
    return {
        cleanResponse,
        results,
        uiDirective,
        uiBlocks,
        executionMode,
        pipelineStages,
        isRefusal: false,
    };
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
