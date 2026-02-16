const logger = require('./logger');
const registry = require('./task-registry');

const EXECUTION_MARKERS = {
    silently: 'silently',
    announce: 'announce',
    ask: 'ask',
    confirm: 'confirm',
};

function parseOrchestrationPlan(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') {
        return null;
    }

    const planRegex = /\[plan\]([\s\S]*?)\[\/plan\]/i;
    const planMatch = rawResponse.match(planRegex);

    if (!planMatch) {
        return null;
    }

    const planBody = planMatch[1].trim();
    const cleanResponse = rawResponse.replace(planMatch[0], '').trim();

    const steps = [];
    const stepRegex = /\[step:\s*(\w+)\s*,\s*marker:\s*(\w+)(?:\s*,\s*((?:[^\]]|\[[^\]]*\])+))?\]/gi;
    let match;

    while ((match = stepRegex.exec(planBody)) !== null) {
        const actionName = match[1].trim();
        const marker = match[2].trim().toLowerCase();
        const paramsStr = match[3] ? match[3].trim() : '';
        const params = {};

        if (paramsStr) {
            const pairs = paramsStr.split(/,\s*(?=\w+:)/);
            for (const pair of pairs) {
                const colonIdx = pair.indexOf(':');
                if (colonIdx === -1) continue;
                const key = pair.substring(0, colonIdx).trim();
                let val = pair.substring(colonIdx + 1).trim();
                if (val.endsWith(',')) val = val.slice(0, -1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (key) params[key] = val;
            }
        }

        steps.push({
            actionName,
            marker: EXECUTION_MARKERS[marker] || 'announce',
            params,
            dependsOn: params._dependsOn || null,
        });

        delete params._dependsOn;
    }

    return { steps, cleanResponse };
}

async function executePlan(steps, context = {}) {
    const results = [];
    const stepOutputs = {};

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const { actionName, marker, params } = step;

        const resolvedParams = resolveParams(params, stepOutputs);

        if (step.dependsOn && stepOutputs[step.dependsOn]?.error) {
            results.push({
                actionName,
                marker,
                skipped: true,
                reason: `Dependency "${step.dependsOn}" failed`,
            });
            continue;
        }

        if (marker === 'confirm' && context.requireConfirmation) {
            results.push({
                actionName,
                marker,
                needsConfirmation: true,
                params: resolvedParams,
            });
            continue;
        }

        if (marker === 'ask' && context.requireClarification) {
            results.push({
                actionName,
                marker,
                needsClarification: true,
                params: resolvedParams,
            });
            continue;
        }

        let executionResult;
        if (registry.has(actionName)) {
            executionResult = await registry.execute(actionName, resolvedParams);
        } else if (context.fallbackExecutor) {
            try {
                executionResult = await context.fallbackExecutor(actionName, resolvedParams);
            } catch (e) {
                executionResult = { error: e.message };
            }
        } else {
            executionResult = { error: `Unknown action: ${actionName}` };
        }

        stepOutputs[`step_${i}`] = executionResult;
        if (!stepOutputs.hasOwnProperty(actionName)) {
            stepOutputs[actionName] = executionResult;
        } else {
            logger.warn(`Duplicate actionName "${actionName}" at step ${i}, using step_${i} for lookup`);
        }

        results.push({
            actionName,
            marker,
            ...executionResult,
        });
    }

    return results;
}

function resolveParams(params, stepOutputs) {
    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' && value.startsWith('$')) {
            const ref = value.slice(1);
            if (stepOutputs[ref]?.result) {
                resolved[key] = stepOutputs[ref].result;
            } else {
                resolved[key] = value;
            }
        } else {
            resolved[key] = value;
        }
    }
    return resolved;
}

function determineResponseMode(results, mode) {
    const hasErrors = results.some(r => r.error);
    const hasConfirmations = results.some(r => r.needsConfirmation);
    const hasClarifications = results.some(r => r.needsClarification);
    const allSilent = results.every(r => r.marker === 'silently');

    if (hasClarifications || hasConfirmations) {
        return mode === 'voice' ? 'spoken' : 'ui';
    }

    if (allSilent && !hasErrors) {
        return 'silent';
    }

    if (mode === 'voice') return 'spoken';
    return 'ui';
}

function buildFeedback(results, mode) {
    const announceResults = results.filter(r => r.marker === 'announce' && (r.success || r.error));
    const feedback = [];

    for (const res of announceResults) {
        if (res.error) {
            feedback.push(`Failed: ${res.actionName} — ${res.error}`);
        }
    }

    for (const res of results) {
        if (res.needsConfirmation) {
            feedback.push(`Need confirmation for: ${res.actionName}`);
        }
        if (res.needsClarification) {
            feedback.push(`Need clarification for: ${res.actionName}`);
        }
        if (res.skipped) {
            feedback.push(`Skipped: ${res.actionName} (${res.reason})`);
        }
    }

    return feedback;
}

module.exports = {
    parseOrchestrationPlan,
    executePlan,
    determineResponseMode,
    buildFeedback,
    EXECUTION_MARKERS,
};
