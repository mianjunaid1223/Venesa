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

async function processResponse(response) {
    // Extract [ui: <component>] directive if present
    let uiDirective = null;
    const uiMatch = response.match(/\[ui:\s*([\w-]+)\]/i);
    if (uiMatch) {
        uiDirective = uiMatch[1].trim();
        response = response.replace(uiMatch[0], '').trim();
    }

    const plan = orchestrator.parseOrchestrationPlan(response);

    if (plan?.steps?.length > 0) {
        const cleanResponse = plan.textBeforePlan || '';
        const results = await orchestrator.executePlan(plan);
        return { cleanResponse, results, uiDirective };
    }

    // Single action parsing
    const actionRegex = /\[action:\s*([^\],]+)((?:,\s*[^,\]]+:\s*[^\],]+)*)\]/g;
    let match;
    const actions = [];

    while ((match = actionRegex.exec(response)) !== null) {
        const actionName = match[1].trim();
        const paramsStr = match[2] || '';
        const params = {};

        if (paramsStr.trim()) {
            const paramPairs = paramsStr.split(',').filter(p => p.includes(':'));
            for (const pair of paramPairs) {
                const colonIndex = pair.indexOf(':');
                if (colonIndex > 0) {
                    const key = pair.substring(0, colonIndex).trim();
                    const value = pair.substring(colonIndex + 1).trim();
                    if (key && value) {
                        params[key] = value;
                    }
                }
            }
        }

        actions.push({ actionName, params });
    }

    const cleanResponse = response.replace(/\[action:[^\]]*\]/g, '').replace(/\[ui:[^\]]*\]/g, '').trim();

    if (actions.length === 0) {
        return { cleanResponse, results: [], uiDirective };
    }

    const results = [];
    for (const action of actions) {
        try {
            const skill = registry.get(action.actionName);
            if (!skill) {
                results.push({
                    actionName: action.actionName,
                    error: `Unknown skill: ${action.actionName}`,
                    skipped: false,
                    marker: 'announce',
                });
                continue;
            }

            const result = await skill.handler(action.params);
            results.push({
                actionName: action.actionName,
                result,
                error: null,
                skipped: false,
                marker: skill.marker || 'announce',
                ui: skill.ui || null,
            });
        } catch (error) {
            results.push({
                actionName: action.actionName,
                error: error.message,
                skipped: false,
                marker: 'announce',
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
