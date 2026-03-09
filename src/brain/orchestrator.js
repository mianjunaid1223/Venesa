const logger = require("../lib/logger");
const registry = require("../skills/registry");
const tokens = require("../lib/token-resolver");
const { z } = require("zod");
const { EXECUTION_MARKERS } = require("./protocol");
const { coerceParams } = require("../skills/validator");

const STEP_REF_PATTERN = /^\$step(\d+)(?:\.(.+))?$/;
const DISCOVERY_SKILLS = new Set(["searchFiles", "search-files"]);
const PATH_PARAMS = new Set(["filePath", "sourcePath", "destPath", "savePath", "path"]);

function unwrapMemoryEnvelope(resolved) {
  if (typeof resolved !== "string") return resolved;
  try {
    const parsed = JSON.parse(resolved);
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return parsed.value;
    }
  } catch {}
  return resolved;
}

function resolveFieldPath(obj, fieldPath) {
  if (!fieldPath) return obj;
  const parts = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof current === "string") {
      try { current = JSON.parse(current); } catch { return undefined; }
    }
    current = current[part];
  }
  return current;
}

function normalizePlan(plan) {
  for (const step of plan.steps) {
    for (const [key, value] of Object.entries(step.params)) {
      if (typeof value !== "string") continue;
      if (value.startsWith("$")) continue;
      if (PATH_PARAMS.has(key)) {
        step.params[key] = tokens.resolvePath(value);
      } else if (value.includes("{{")) {
        step.params[key] = tokens.resolveString(value);
      }
    }
  }
  return plan;
}

function validatePlan(plan) {
  const totalSteps = plan.steps.length;
  let hasDiscovery = false;

  for (let i = 0; i < totalSteps; i++) {
    const step = plan.steps[i];
    const priorHasDiscovery = hasDiscovery;

    for (const [key, value] of Object.entries(step.params)) {
      if (typeof value !== "string") continue;
      const refMatch = value.match(STEP_REF_PATTERN);
      if (refMatch) {
        const refIndex = parseInt(refMatch[1], 10);
        if (refIndex < 1 || refIndex > totalSteps || refIndex > i) {
          return { valid: false, error: `Step ${i + 1} references non-existent $step${refIndex}` };
        }
        continue;
      }
      if (priorHasDiscovery && PATH_PARAMS.has(key) && !value.startsWith("$")) {
        return { valid: false, error: `Step ${i + 1} uses guessed path for '${key}' after a discovery step. Use $stepN.field to reference search results.` };
      }
    }

    hasDiscovery = priorHasDiscovery || DISCOVERY_SKILLS.has(step.actionName);
  }
  return { valid: true };
}

function parseActionsStrict(text) {
  const actions = [];
  let i = 0;

  while (i < text.length) {
    let actionStart = text.indexOf("[action:", i);
    if (actionStart === -1) break;

    let bracketDepth = 1;
    let j = actionStart + 8;
    let actionContentEnd = -1;

    let inQuotes = false;
    let quoteChar = "";
    let isEscaped = false;

    while (j < text.length) {
      const char = text[j];
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"' || char === "'") {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (quoteChar === char) {
          inQuotes = false;
        }
      } else if (!inQuotes) {
        if (char === "[") bracketDepth++;
        else if (char === "]") {
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
      logger.error(`Malformed action tag started at index ${actionStart}`);
      break;
    }

    const rawContent = text.substring(actionStart + 8, actionContentEnd).trim();
    const firstComma = rawContent.indexOf(",");

    let actName = "";
    let rawParams = "";

    if (firstComma === -1) {
      actName = rawContent.trim();
    } else {
      actName = rawContent.substring(0, firstComma).trim();
      rawParams = rawContent.substring(firstComma + 1).trim();
    }

    const params = {};
    if (rawParams) {
      let pStr = rawParams;
      let currentKey = "";
      let currentVal = "";
      let readingKey = true;
      let inStr = false;
      let qChar = "";
      let escaped = false;
      let pBracketDepth = 0;

      for (let k = 0; k < pStr.length; k++) {
        const c = pStr[k];
        if (escaped) {
          if (c === '"' || c === "'" || c === "[" || c === "]" || c === "\\") {
            currentVal += c;
          } else {
            currentVal += "\\" + c;
          }
          escaped = false;
          continue;
        }
        if (c === "\\") {
          escaped = true;
          continue;
        }

        if ((c === '"' || c === "'") && readingKey === false) {
          if (!inStr) {
            inStr = true;
            qChar = c;
          } else if (qChar === c) {
            inStr = false;
          } else {
            currentVal += c;
          }
        } else if (!inStr && c === "[") {
          pBracketDepth++;
          if (!readingKey) currentVal += c;
        } else if (!inStr && c === "]") {
          pBracketDepth--;
          if (!readingKey) currentVal += c;
        } else if (!inStr && c === ":") {
          if (readingKey) {
            readingKey = false;
          } else {
            currentVal += c;
          }
        } else if (!inStr && pBracketDepth === 0 && c === ",") {
          if (currentKey.trim()) params[currentKey.trim()] = currentVal.trim();
          currentKey = "";
          currentVal = "";
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
      marker:
        params.marker && EXECUTION_MARKERS[params.marker]
          ? EXECUTION_MARKERS[params.marker]
          : EXECUTION_MARKERS.announce,
    });

    i = actionContentEnd + 1;
  }

  return actions;
}

function parseOrchestrationPlan(rawResponse) {
  if (!rawResponse || typeof rawResponse !== "string") return null;

  const normalizedBlocks = rawResponse.replace(/\[step:/gi, "[action:");
  const steps = parseActionsStrict(normalizedBlocks);
  if (steps.length === 0) return null;

  const planStart = rawResponse.toLowerCase().indexOf("[plan]");
  const textBeforePlan = planStart !== -1
    ? rawResponse.substring(0, planStart).trim()
    : rawResponse.split("[")[0].trim();

  return {
    steps,
    rawPlan: rawResponse,
    textBeforePlan,
    planId: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  };
}

async function executeAction(actionName, params, ctx = {}) {
  const trace = {
    planId: ctx.planId || "single",
    stepIndex: ctx.stepIndex || 0,
    actionName,
    timestamp: Date.now(),
    duration: 0,
  };

  // Resolve {{token}} placeholders before validation and execution
  try {
    params = tokens.resolve(params);
  } catch (tokenErr) {
    return {
      success: false,
      error: tokenErr.message,
      trace,
      marker: ctx.marker || "announce",
      envKey: tokenErr.code === "ENV_NOT_SET" ? tokenErr.envKey : null,
    };
  }

  const startTime = process.hrtime();

  try {
    const skill = registry.get(actionName);
    if (!skill) {
      throw new Error(`Unknown skill: ${actionName}`);
    }
    if (skill._enabled === false) {
      throw new Error(`Skill ${actionName} is currently disabled.`);
    }

    if (typeof skill.handler !== "function") {
      throw new Error(
        `Skill ${actionName} has no handler or handler is not a function`,
      );
    }

    let validatedParams = params;
    if (skill.schema) {
      try {
        validatedParams = skill.schema.parse(
          coerceParams(params, skill.schema),
        );
      } catch (err) {
        if (
          err instanceof z.ZodError ||
          (err && err.name === "ZodError" && err.issues)
        ) {
          const issues = err.issues || err.errors || [];
          const messages = issues
            .map((e) => {
              const path = Array.isArray(e.path) ? e.path.join(".") : "root";
              return `${path}: ${e.message}`;
            })
            .join(", ");
          throw new Error(`Validation failed for ${actionName}: ${messages}`);
        }
        throw err;
      }
    }

    const handlerPromise = skill.handler(validatedParams);
    const timeoutDuration = 30000;
    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(
        () =>
          reject(
            new Error(
              `Action ${actionName} timed out after ${timeoutDuration}ms`,
            ),
          ),
        timeoutDuration,
      );
    });

    let output;
    try {
      output = await Promise.race([handlerPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }

    const diff = process.hrtime(startTime);
    trace.duration = (diff[0] * 1e9 + diff[1]) / 1e6;

    logger.debug(
      `[TRACE] Executed ${actionName} in ${trace.duration.toFixed(2)}ms`,
    );

    return {
      success: true,
      output,
      trace,
      marker: ctx.marker || skill.marker || "announce",
      ui: skill.ui || null,
      returnType: skill.returnType || "action",
    };
  } catch (error) {
    const diff = process.hrtime(startTime);
    trace.duration = (diff[0] * 1e9 + diff[1]) / 1e6;
    logger.error(
      `[TRACE] Action ${actionName} failed in ${trace.duration.toFixed(2)}ms - ${error.message}`,
    );

    return {
      success: false,
      error: error.message,
      trace,
      marker: ctx.marker || "announce",
    };
  }
}

function resolveStepRefs(params, stepOutputs, stepIndex) {
  const resolved = { ...params };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value !== "string") continue;
    const refMatch = value.match(STEP_REF_PATTERN);
    if (!refMatch) continue;
    const refIdx = parseInt(refMatch[1], 10) - 1;
    const fieldPath = refMatch[2] || null;
    if (refIdx < 0 || refIdx >= stepIndex || !(refIdx in stepOutputs)) {
      throw new Error(`$step${refIdx + 1} not resolved for step ${stepIndex + 1}`);
    }
    if (stepOutputs[refIdx] === null) {
      throw new Error(`Referenced step $step${refIdx + 1} failed or returned no output`);
    }
    const raw = unwrapMemoryEnvelope(stepOutputs[refIdx]);
    if (raw === null) {
      throw new Error(`Referenced step $step${refIdx + 1} failed or returned no output`);
    }
    resolved[key] = fieldPath ? resolveFieldPath(raw, fieldPath) : raw;
    if (resolved[key] === undefined) {
      throw new Error(`Field '${fieldPath}' not found in $step${refIdx + 1} output`);
    }
  }
  return resolved;
}

function skipRemaining(plan, results, fromIndex) {
  for (let j = fromIndex; j < plan.steps.length; j++) {
    results.push({
      actionName: plan.steps[j].actionName,
      result: null,
      error: "Aborted due to preceding failure",
      skipped: true,
      marker: "silently",
      ui: null,
      returnType: null,
    });
  }
}

async function executePlan(plan) {
  if (!plan || !plan.steps) {
    return [{ actionName: "_planValidation", result: null, error: "Invalid or missing plan", skipped: false, marker: "announce", ui: null, returnType: null }];
  }
  const validation = validatePlan(plan);
  if (!validation.valid) {
    logger.warn(`Plan ${plan.planId} rejected: ${validation.error}`);
    return [{ actionName: "_planValidation", result: null, error: validation.error, skipped: false, marker: "announce", ui: null, returnType: null }];
  }
  normalizePlan(plan);

  const results = [];
  const stepOutputs = [];

  logger.info(`Executing plan: ${plan.planId} (${plan.steps.length} steps)`);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    try {
      const resolvedParams = resolveStepRefs(step.params, stepOutputs, i);
      const result = await executeAction(step.actionName, resolvedParams, {
        planId: plan.planId,
        stepIndex: i,
        marker: step.marker,
      });

      stepOutputs[i] = result.success ? result.output : null;

      results.push({
        actionName: step.actionName,
        result: result.output,
        error: result.error || null,
        skipped: false,
        marker: result.marker,
        ui: result.ui || null,
        returnType: result.returnType || "action",
        envKey: result.envKey || null,
      });

      if (!result.success) {
        logger.warn(`Plan ${plan.planId} aborted at step ${i} (${step.actionName})`);
        skipRemaining(plan, results, i + 1);
        break;
      }
    } catch (error) {
      logger.error(`Plan step ${step.actionName} failed: ${error.message}`);
      results.push({
        actionName: step.actionName,
        result: null,
        error: error.message,
        skipped: false,
        marker: step.marker,
        ui: null,
        returnType: null,
      });
      skipRemaining(plan, results, i + 1);
      break;
    }
  }

  return results;
}

module.exports = {
  parseOrchestrationPlan,
  parseActionsStrict,
  normalizePlan,
  validatePlan,
  executePlan,
  executeAction,
};
