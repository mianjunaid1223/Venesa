// LLM — Gemini API client. Manages queries and prompt caching.
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../lib/logger");
const keyPool = require("../lib/key-pool");
const settings = require("./settings");

let genAI = null;
let activeKey = null;

// TTL-based prompt cache rebuilt at most once every 60s per mode.
const PROMPT_TTL_MS = 60_000;
const promptCache = {
  text: { prompt: null, builtAt: 0 },
  voice: { prompt: null, builtAt: 0 },
};

function getSystemPromptCached(userName, mode) {
  const resolvedMode = promptCache[mode] ? mode : "text";
  const entry = promptCache[resolvedMode];
  const now = Date.now();
  if (!entry.prompt || now - entry.builtAt > PROMPT_TTL_MS) {
    const getSystemPrompt = require("./system-prompt");
    entry.prompt = getSystemPrompt(userName, resolvedMode);
    entry.builtAt = now;
    logger.debug(`[LLM] Rebuilt ${resolvedMode} system prompt`);
  }
  return entry.prompt;
}

/** Force-expire the prompt cache (e.g. after settings save or memory write). */
function invalidatePromptCache() {
  promptCache.text.builtAt = 0;
  promptCache.voice.builtAt = 0;
}

async function initializeAPI() {
  const apiKey = keyPool.getNextKey("gemini");
  if (!apiKey) {
    await keyPool.initialize();
    const retryKey = keyPool.getNextKey("gemini");
    if (!retryKey) {
      logger.error("No valid Gemini API keys found.");
      throw new Error("No valid Gemini API keys found.");
    }
    activeKey = retryKey;
    genAI = new GoogleGenerativeAI(activeKey);
  } else {
    activeKey = apiKey;
    genAI = new GoogleGenerativeAI(activeKey);
  }

  invalidatePromptCache();
  logger.info("LLM API initialized");
}

function needsSetup() {
  const fs = require("fs");
  return !keyPool.hasKeys("gemini") || !fs.existsSync(settings.SETTINGS_PATH);
}

function getModel(mode = "text") {
  if (!genAI) {
    throw new Error(
      "LLM not initialized. genAI is missing. Call initializeAPI() before getModel().",
    );
  }
  const s = settings.load();
  const servicesConfig = require("./services.config");

  const systemInstruction = getSystemPromptCached(s.userName, mode);

  return genAI.getGenerativeModel({
    model: s.modelName || servicesConfig.gemini.model,
    systemInstruction,
    generationConfig: servicesConfig.gemini.generationConfig,
    safetySettings: servicesConfig.gemini.safetySettings,
  });
}

function createFreshChat(mode = "text") {
  const model = getModel(mode);
  return model.startChat({ history: [] });
}

async function sendQuery(query, imageData = null, mode = "text") {
  if (!genAI) {
    throw new Error("LLM not initialized");
  }

  const maxRetries = 3;
  let lastError = null;

  // Pre-parse imageData once before the retry loop so validation errors
  // (e.g. invalid mimeType) are not counted as retryable failures.
  let parsedMimeType = null;
  let parsedBase64Data = null;

  if (imageData) {
    let mimeType = "application/octet-stream";
    let base64Data = imageData;
    const dataUriMatch = imageData.match(
      /^data:([^;,]+)(?:;[^;,]+)*;base64,(.*)$/i,
    );

    if (dataUriMatch) {
      mimeType = dataUriMatch[1];
      base64Data = dataUriMatch[2];
    } else if (imageData.startsWith("base64,")) {
      base64Data = imageData.substring(7);
    } else if (imageData.includes(",")) {
      base64Data = imageData.split(",")[1];
    } else {
      const cleanData = imageData.replace(/\s/g, "");
      if (
        cleanData.length >= 64 &&
        cleanData.length % 4 === 0 &&
        /^[A-Za-z0-9+/=]+$/.test(cleanData)
      ) {
        base64Data = cleanData;
      } else {
        logger.warn("[LLM] base64 validation failed — dropping image");
        base64Data = null;
      }
    }

    if (base64Data && mimeType === "application/octet-stream") {
      logger.error(
        '[LLM] Invalid image mimeType "application/octet-stream". Please provide a valid IANA media type.',
      );
      throw new Error(
        "Invalid image mimeType. Please provide a valid IANA media type.",
      );
    }

    parsedMimeType = mimeType;
    parsedBase64Data = base64Data;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const chat = createFreshChat(mode);
      let result;

      if (imageData) {
        if (parsedBase64Data) {
          result = await chat.sendMessage([
            query,
            {
              inlineData: {
                mimeType: parsedMimeType,
                data: parsedBase64Data,
              },
            },
          ]);
        } else {
          result = await chat.sendMessage(query);
        }
      } else {
        result = await chat.sendMessage(query);
      }

      const responseText = result.response.text();
      if (activeKey) keyPool.reportSuccess("gemini", activeKey);
      logger.info(`[LLM raw] (${mode}, attempt ${attempt + 1}): ${responseText}`);

      return responseText;
    } catch (error) {
      lastError = error;
      logger.error(
        `LLM query failed (attempt ${attempt + 1}): ${error.message}`,
      );

      if (activeKey) {
        const { keyHandled } = keyPool.reportError("gemini", activeKey, error);
        if (keyHandled) {
          const nextKey = keyPool.getNextKey("gemini");
          if (!nextKey) {
            // No usable keys remain — stop retrying immediately.
            activeKey = null;
            genAI = null;
            break;
          }
          activeKey = nextKey;
          genAI = new GoogleGenerativeAI(activeKey);
          invalidatePromptCache();
        }
      }
    }
  }

  if (lastError) {
    const msg = lastError.message || "";
    if (msg.includes("429") && msg.includes("quota")) {
      throw new Error(
        "Gemini API quota exceeded. Please wait a few moments or check your API key limits in Settings.",
      );
    } else if (msg.includes("GoogleGenerativeAI Error")) {
      // Attempt to cleanly extract the main reason without the JSON dump
      const match = msg.match(/\[(.*?)\] (.*?)(?:\r?\n| \[|$)/);
      if (match && match[2]) {
        throw new Error(match[2].trim());
      }
    }
  }

  throw lastError || new Error("Query failed after retries");
}

module.exports = {
  initializeAPI,
  sendQuery,
  needsSetup,
  invalidatePromptCache,
};
