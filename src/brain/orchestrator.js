/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Orchestrator
 *  Multi-step plan parser + executor for [plan]...[/plan] blocks.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, skills/registry
 *  USED BY:    brain/processor
 * ═══════════════════════════════════════════════════════════════
 */

const logger = require('../lib/logger');
const registry = require('../skills/registry');

const EXECUTION_MARKERS = {
    silently: 'silently',
    announce: 'announce',
    ask: 'ask',
    confirm: 'confirm',
};

function parseParams(paramsStr) {
    const params = {};
    let inQuotes = false;
    let quoteChar = '';
    let tokens = [];
    let current = '';

    for (let i = 0; i < paramsStr.length; i++) {
        const char = paramsStr[i];

        let backslashCount = 0;
        let j = i - 1;
        while (j >= 0 && paramsStr[j] === '\\') {
            backslashCount++;
            j--;
        }
        const isEscaped = backslashCount % 2 !== 0;

        if ((char === '"' || char === "'") && !isEscaped) {
            if (!inQuotes) { inQuotes = true; quoteChar = char; }
            else if (quoteChar === char) { inQuotes = false; }
            current += char;
        } else if (char === ',' && !inQuotes) {
            tokens.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    if (current) tokens.push(current);

    tokens.forEach(token => {
        const colonIndex = token.indexOf(':');
        if (colonIndex > 0) {
            const key = token.substring(0, colonIndex).trim();
            let value = token.substring(colonIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
            }
            if (key) params[key] = value;
        }
    });

    return params;
}

function parseOrchestrationPlan(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') {
        return null;
    }

    const planRegex = /\[plan\]([\s\S]*?)\[\/plan\]/i;
    const planMatch = rawResponse.match(planRegex);

    if (!planMatch) {
        return null;
    }

    const planBlock = planMatch[1].trim();
    const stepRegex = /\[step:\s*([^\],]+)(?:,\s*marker:\s*([^\],]+))?((?:,\s*[^,\]]+:\s*[^\],]+)*)\]/g;
    const steps = [];
    let stepMatch;

    while ((stepMatch = stepRegex.exec(planBlock)) !== null) {
        const actionName = stepMatch[1].trim();
        const marker = (stepMatch[2] || 'announce').trim();
        const paramsStr = stepMatch[3] || '';
        const params = {};

        if (paramsStr.trim()) {
            Object.assign(params, parseParams(paramsStr));
        }

        steps.push({
            actionName,
            marker: EXECUTION_MARKERS[marker] || 'announce',
            params,
            dependsOn: Object.values(params).filter(v => typeof v === 'string' && v.startsWith('$')),
        });
    }

    if (steps.length === 0) return null;

    const textBeforePlan = rawResponse.substring(0, rawResponse.indexOf(planMatch[0])).trim();

    return {
        steps,
        rawPlan: planBlock,
        textBeforePlan,
    };
}

async function executePlan(plan) {
    const results = [];
    const stepResults = {};

    for (const step of plan.steps) {
        try {
            const resolvedParams = { ...step.params };

            for (const [key, value] of Object.entries(resolvedParams)) {
                if (typeof value === 'string' && value.startsWith('$')) {
                    const depName = value.substring(1);
                    const foundKey = Object.keys(stepResults).reverse().find(k => k.startsWith(depName + '_'));
                    if (foundKey && stepResults[foundKey] !== undefined) {
                        resolvedParams[key] = stepResults[foundKey];
                    } else {
                        throw new Error(`Dependency ${depName} not found for step ${step.actionName}`);
                    }
                }
            }

            const skill = registry.get(step.actionName);
            if (!skill) {
                results.push({
                    actionName: step.actionName,
                    error: `Unknown skill: ${step.actionName}`,
                    skipped: false,
                    marker: step.marker,
                });
                continue;
            }

            const handlerPromise = skill.handler(resolvedParams);
            const timeoutDuration = 30000;
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Step ${step.actionName} timed out after ${timeoutDuration}ms`)), timeoutDuration));
            const result = await Promise.race([handlerPromise, timeoutPromise]);
            const stepKey = `${step.actionName}_${plan.steps.indexOf(step)}`;
            stepResults[stepKey] = result;

            results.push({
                actionName: step.actionName,
                result,
                error: null,
                skipped: false,
                marker: step.marker,
                ui: skill.ui || null,
            });

        } catch (error) {
            logger.error(`Plan step ${step.actionName} failed: ${error.message}`);
            results.push({
                actionName: step.actionName,
                error: error.message,
                skipped: false,
                marker: step.marker,
            });
        }
    }

    return results;
}

module.exports = {
    parseOrchestrationPlan,
    executePlan,
    EXECUTION_MARKERS,
};
