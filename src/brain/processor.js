// Processor — parses LLM responses, dispatches to skills, returns structured results.
const orchestrator = require("./orchestrator");
const { EXECUTION_MODES, WORKFLOW_STAGES } = require("./protocol");

try {
  require("../skills/loader");
} catch (e) {
  const logger = require("../lib/logger");
  logger.error(`[processor] Failed to load skills: ${e?.message ?? String(e)}`);
}

function extractSpeakBlock(response) {
  const speakMatch = response.match(/\[speak\]([\s\S]*?)\[\/speak\]/i);
  if (speakMatch) {
    const speakText = speakMatch[1].trim();
    const remainder = response.replace(speakMatch[0], "").trim();
    return { speakText, remainder, hasSpeak: true };
  }
  return { speakText: null, remainder: response, hasSpeak: false };
}

function unwrapSilentBlocks(text) {
  return text
    .replace(/\[silent\]/gi, "")
    .replace(/\[\/silent\]/gi, "")
    .trim();
}

function extractUiBlocks(text) {
  const uiBlocks = [];
  const regex = /\[ui\]([\s\S]*?)\[\/ui\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content) uiBlocks.push(content);
  }
  const remainder = text.replace(regex, "").trim();
  return { uiBlocks, remainder };
}

function classifyExecutionMode(results, uiBlocks, uiDirective, cleanResponse) {
  if (results.length === 0 && uiBlocks.length === 0 && !uiDirective) {
    if (isStructuredRefusal(cleanResponse)) return EXECUTION_MODES.refuse;
    return EXECUTION_MODES.data;
  }
  if (
    results.length > 0 &&
    results.every((r) => r.returnType === "data" || r.returnType === "memory")
  ) {
    return EXECUTION_MODES.data;
  }
  if ((uiBlocks.length > 0 || uiDirective) && results.length === 0) {
    return EXECUTION_MODES.ui;
  }
  return EXECUTION_MODES.execute;
}

function isStructuredRefusal(text) {
  if (!text) return false;
  return /^cannot\s+\S.{0,120}[.:]/i.test(text.trim());
}

function getEngagedStages(results, uiBlocks, uiDirective, mode) {
  const stages = [WORKFLOW_STAGES[0], WORKFLOW_STAGES[1], WORKFLOW_STAGES[2]];
  if (mode === EXECUTION_MODES.refuse) return stages;
  if (results.length > 0) stages.push(WORKFLOW_STAGES[3]);
  stages.push(WORKFLOW_STAGES[4]);
  if (uiBlocks.length > 0 || uiDirective) stages.push(WORKFLOW_STAGES[5]);
  const hasMemoryOp = results.some((r) => r.returnType === "memory");
  if (hasMemoryOp) stages.push(WORKFLOW_STAGES[6]);
  return stages;
}

async function processResponse(response) {
  const { speakText, remainder, hasSpeak } = extractSpeakBlock(response);

  const actionableText = unwrapSilentBlocks(remainder);

  const { uiBlocks, remainder: textAfterUi } = extractUiBlocks(actionableText);

  let uiDirective = null;
  let textForParsing = textAfterUi;
  const uiMatch = textForParsing.match(/\[ui:\s*([\w-]+)\]/i);
  if (uiMatch) {
    uiDirective = uiMatch[1].trim();
    textForParsing = textForParsing.replace(uiMatch[0], "").trim();
  }

  const plan = orchestrator.parseOrchestrationPlan(textForParsing);

  if (plan?.steps?.length > 0) {
    let cleanResponse;
    if (hasSpeak) {
      cleanResponse = speakText;
    } else {
      cleanResponse = response
        .replace(/\[action:[^\]]*\]/gi, "")
        .replace(/\[plan\](.|[\n\r])*?\[\/plan\]/gi, "")
        .replace(/\[ui:[^\]]*\]/gi, "")
        .replace(/\[ui\][\s\S]*?\[\/ui\]/gi, "")
        .replace(/\[silent\]([\s\S]*?)\[\/silent\]/gi, "")
        .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, "$1")
        .trim();

      if (cleanResponse.includes("[action:")) {
        cleanResponse = cleanResponse.split("[action:")[0].trim();
      }
    }

    const rawResults = await orchestrator.executePlan(plan);
    const results = rawResults.map((r) => ({
      actionName: r.actionName,
      result: r.result !== undefined ? r.result : null,
      error: r.error || null,
      skipped: r.skipped || false,
      marker: r.marker || "announce",
      ui: r.ui || null,
      returnType: r.returnType || "action",
      envKey: r.envKey || null,
    }));
    const executionMode = classifyExecutionMode(
      results,
      uiBlocks,
      uiDirective,
      cleanResponse,
    );
    const pipelineStages = getEngagedStages(
      results,
      uiBlocks,
      uiDirective,
      executionMode,
    );
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

  const actions = orchestrator.parseActionsStrict(textForParsing);

  let cleanResponse;
  if (hasSpeak) {
    cleanResponse = speakText;
  } else {
    cleanResponse = response
      .replace(/\[action:[^\]]*\]/gi, "")
      .replace(/\[ui:[^\]]*\]/gi, "")
      .replace(/\[ui\][\s\S]*?\[\/ui\]/gi, "")
      .replace(/\[silent\]([\s\S]*?)\[\/silent\]/gi, "")
      .replace(/\[speak\]([\s\S]*?)\[\/speak\]/gi, "$1")
      .trim();
  }

  if (actions.length === 0) {
    const executionMode = classifyExecutionMode(
      [],
      uiBlocks,
      uiDirective,
      cleanResponse,
    );
    const pipelineStages = getEngagedStages(
      [],
      uiBlocks,
      uiDirective,
      executionMode,
    );
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
      const result = await orchestrator.executeAction(
        action.actionName,
        action.params,
        {
          planId: "single",
          stepIndex: index,
          marker: action.marker,
        },
      );

      results.push({
        actionName: action.actionName,
        result: result.success ? result.output : null,
        error: result.error || null,
        skipped: false,
        marker: result.marker || "announce",
        ui: result.ui || null,
        returnType: result.returnType || "action",
        envKey: result.envKey || null,
      });
    } catch (error) {
      results.push({
        actionName: action.actionName,
        result: null,
        error: error.message || String(error),
        skipped: false,
        marker: action.marker || "silently",
        ui: null,
        returnType: "action",
      });
    }
  }

  const executionMode = classifyExecutionMode(
    results,
    uiBlocks,
    uiDirective,
    cleanResponse,
  );
  const pipelineStages = getEngagedStages(
    results,
    uiBlocks,
    uiDirective,
    executionMode,
  );
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

module.exports = {
  processResponse,
};
