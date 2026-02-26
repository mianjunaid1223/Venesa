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
const { z } = require('zod');

const EXECUTION_MARKERS = {
    silently: 'silently',
    announce: 'announce',
    ask: 'ask',
    confirm: 'confirm',
};

// Formal lexer and parser for Venesa's output schema
function parseActionsStrict(text) {
    const actions = [];
    let i = 0;

    while (i < text.length) {
        let actionStart = text.indexOf('[action:', i);
        if (actionStart === -1) break;

        // Find the matching closing bracket
        let bracketDepth = 1;
        let j = actionStart + 8; // skip '[action:'
        let actionContentEnd = -1;

        let inQuotes = false;
        let quoteChar = '';
        let isEscaped = false;

        while (j < text.length) {
            const char = text[j];
            if (isEscaped) {
                isEscaped = false;
            } else if (char === '\\') {
                isEscaped = true;
            } else if (char === '"' || char === "'") {
                if (!inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (quoteChar === char) {
                    inQuotes = false;
                }
            } else if (!inQuotes) {
                if (char === '[') bracketDepth++;
                else if (char === ']') {
                    bracketDepth--;
                    if (bracketDepth === 0) {
                        actionContentEnd = j;
                        break;
                    }
                }
            }
            j++;
        }

        if (actionContentEnd === -1) {
            // Malformed action tag, no closing bracket
            logger.error(`Malformed action tag started at index ${actionStart}`);
            break;
        }

        const rawContent = text.substring(actionStart + 8, actionContentEnd).trim();
        const firstComma = rawContent.indexOf(',');

        let actName = '';
        let rawParams = '';

        if (firstComma === -1) {
            actName = rawContent.trim();
        } else {
            actName = rawContent.substring(0, firstComma).trim();
            rawParams = rawContent.substring(firstComma + 1).trim();
        }

        const params = {};
        if (rawParams) {
            // Parse parameters
            let pStr = rawParams;
            let currentKey = '';
            let currentVal = '';
            let readingKey = true;
            let inStr = false;
            let qChar = '';
            let escaped = false;
            let pBracketDepth = 0;

            for (let k = 0; k < pStr.length; k++) {
                const c = pStr[k];
                if (escaped) { currentVal += c; escaped = false; continue; }
                if (c === '\\') { escaped = true; continue; }

                if ((c === '"' || c === "'") && readingKey === false) {
                    if (!inStr) { inStr = true; qChar = c; }
                    else if (qChar === c) { inStr = false; }
                    else { currentVal += c; }
                } else if (!inStr && c === '[') {
                    pBracketDepth++;
                    if (!readingKey) currentVal += c;
                } else if (!inStr && c === ']') {
                    pBracketDepth--;
                    if (!readingKey) currentVal += c;
                } else if (!inStr && c === ':') {
                    if (readingKey) {
                        readingKey = false;
                    } else {
                        currentVal += c;
                    }
                } else if (!inStr && pBracketDepth === 0 && c === ',') {
                    if (currentKey.trim()) params[currentKey.trim()] = currentVal.trim();
                    currentKey = '';
                    currentVal = '';
                    readingKey = true;
                } else {
                    if (readingKey) currentKey += c;
                    else currentVal += c;
                }
            }
            if (currentKey.trim()) params[currentKey.trim()] = currentVal.trim();
        }

        actions.push({
            actionName: actName,
            params: params,
            marker: params.marker && EXECUTION_MARKERS[params.marker] ? EXECUTION_MARKERS[params.marker] : 'announce'
        });

        i = actionContentEnd + 1;
    }

    return actions;
}

function parseOrchestrationPlan(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') {
        return null;
    }

    const normalizedBlocks = rawResponse.replace(/\[step:/gi, '[action:');
    const steps = parseActionsStrict(normalizedBlocks);

    if (steps.length === 0) return null;

    // determine dependencies
    for (const step of steps) {
        step.dependsOn = Object.values(step.params).filter(v => typeof v === 'string' && v.startsWith('$'));
    }

    const planStart = rawResponse.toLowerCase().indexOf('[plan]');
    const textBeforePlan = planStart !== -1 ? rawResponse.substring(0, planStart).trim() : rawResponse.split('[')[0].trim();

    // Only treat as plan if multiple steps, or if explicitly wrapped in a top level [plan] block 
    // (though even if single step, executePlan handles it fine)
    return {
        steps,
        rawPlan: rawResponse,
        textBeforePlan,
        planId: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
}

async function executeAction(actionName, params, ctx = {}) {
    const trace = {
        planId: ctx.planId || 'single',
        stepIndex: ctx.stepIndex || 0,
        actionName,
        timestamp: Date.now(),
        duration: 0
    };

    const startTime = process.hrtime();

    try {
        const skill = registry.get(actionName);
        if (!skill) {
            throw new Error(`Unknown skill: ${actionName}`);
        }
        if (skill._enabled === false) {
            throw new Error(`Skill ${actionName} is currently disabled.`);
        }

        // Schema validation
        let validatedParams = params;
        if (skill.schema) {
            try {
                validatedParams = skill.schema.parse(params);
            } catch (err) {
                if (err instanceof z.ZodError || (err && err.name === 'ZodError' && err.issues)) {
                    const issues = err.issues || err.errors || [];
                    const messages = issues.map(e => {
                        const path = Array.isArray(e.path) ? e.path.join('.') : 'root';
                        return `${path}: ${e.message}`;
                    }).join(', ');
                    throw new Error(`Validation failed for ${actionName}: ${messages}`);
                }
                throw err;
            }
        }

        const handlerPromise = skill.handler(validatedParams);
        const timeoutDuration = 30000;
        let timerId;
        const timeoutPromise = new Promise((_, reject) => {
            timerId = setTimeout(() => reject(new Error(`Action ${actionName} timed out after ${timeoutDuration}ms`)), timeoutDuration);
        });

        let output;
        try {
            output = await Promise.race([handlerPromise, timeoutPromise]);
        } finally {
            clearTimeout(timerId);
        }

        const diff = process.hrtime(startTime);
        trace.duration = (diff[0] * 1e9 + diff[1]) / 1e6; // ms

        logger.debug(`[TRACE] Executed ${actionName} in ${trace.duration.toFixed(2)}ms`);

        return {
            success: true,
            output,
            trace,
            marker: ctx.marker || skill.marker || 'announce',
            ui: skill.ui || null
        };
    } catch (error) {
        const diff = process.hrtime(startTime);
        trace.duration = (diff[0] * 1e9 + diff[1]) / 1e6; // ms
        logger.error(`[TRACE] Action ${actionName} failed in ${trace.duration.toFixed(2)}ms - ${error.message}`);

        return {
            success: false,
            error: error.message,
            trace,
            marker: ctx.marker || 'announce'
        };
    }
}

async function executePlan(plan) {
    const results = [];
    const stepOutputs = {};

    logger.info(`Starting execution of plan: ${plan.planId} (${plan.steps.length} steps)`);

    for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];

        try {
            // Resolve parameters
            const resolvedParams = { ...step.params };
            for (const [key, value] of Object.entries(resolvedParams)) {
                if (typeof value === 'string' && value.startsWith('$')) {
                    const depName = value.substring(1);
                    // Match the exact actionName_stepIndex format
                    const foundKey = Object.keys(stepOutputs).reverse().find(k => k === depName);
                    if (foundKey && stepOutputs[foundKey] !== undefined) {
                        resolvedParams[key] = stepOutputs[foundKey];
                    } else {
                        // fallback to finding the last action with the matching prefix (if they just typed $echo)
                        const prefixMatch = Object.keys(stepOutputs).reverse().find(k => k.startsWith(depName + '_'));
                        if (prefixMatch && stepOutputs[prefixMatch] !== undefined) {
                            resolvedParams[key] = stepOutputs[prefixMatch];
                        } else {
                            throw new Error(`Dependency ${depName} not found for step ${step.actionName}`);
                        }
                    }
                }
            }

            const result = await executeAction(step.actionName, resolvedParams, {
                planId: plan.planId,
                stepIndex: i,
                marker: step.marker
            });

            const stepKey = `${step.actionName}_${i}`;
            stepOutputs[stepKey] = result.success ? result.output : undefined;

            results.push({
                actionName: step.actionName,
                result: result.output,
                error: result.error || null,
                skipped: false,
                marker: result.marker,
                ui: result.ui || null,
            });

            // Step-level transaction handling - Abort remaining if failed
            if (!result.success) {
                logger.warn(`Plan ${plan.planId} aborted at step ${i} (${step.actionName}) due to failure.`);
                // Mark remaining steps as skipped
                for (let j = i + 1; j < plan.steps.length; j++) {
                    results.push({
                        actionName: plan.steps[j].actionName,
                        result: null,
                        error: 'Aborted due to preceding failure',
                        skipped: true,
                        marker: 'silently',
                        ui: null
                    });
                }
                break;
            }

        } catch (error) {
            logger.error(`Plan step ${step.actionName} orchestration failed: ${error.message}`);
            results.push({
                actionName: step.actionName,
                result: null,
                error: error.message,
                skipped: false,
                marker: step.marker,
                ui: null
            });
            for (let j = i + 1; j < plan.steps.length; j++) {
                results.push({
                    actionName: plan.steps[j].actionName,
                    result: null,
                    error: 'Aborted due to preceding failure',
                    skipped: true,
                    marker: 'silently',
                    ui: null
                });
            }
            break; // Stop on resolution failure too
        }
    }

    return results;
}

module.exports = {
    parseOrchestrationPlan,
    parseActionsStrict,
    executePlan,
    executeAction,
    EXECUTION_MARKERS,
};
