const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");
const os = require("os");
const logger = require('./logger');
const keyPool = require("./apiKeyPool");
const userProfile = require("./user-profile");

const SETTINGS_PATH = path.join(os.homedir(), ".venesa-settings.json");

const DEFAULT_SETTINGS = {
  modelName: "gemini-2.5-flash-lite",
  userName: "User",
  openAtLogin: true,
};



function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, "utf8").trim();
      if (data) {
        const saved = JSON.parse(data);
        const settings = { ...DEFAULT_SETTINGS, ...saved };

        if (!settings.modelName || settings.modelName.trim() === "") {
          settings.modelName = DEFAULT_SETTINGS.modelName;
        }

        return settings;
      }
    }
  } catch (error) {
    logger.error(`Load settings error: ${error.message}`);
    try {
      fs.unlinkSync(SETTINGS_PATH);
    } catch (e) { }
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(newSettings) {
  try {
    const currentSettings = loadSettings();
    const mergedSettings = { ...currentSettings, ...newSettings };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(mergedSettings, null, 2));
    return true;
  } catch (error) {
    logger.error(`Save settings error: ${error.message}`);
    return false;
  }
}

function needsSetup() {
  const settings = loadSettings();
  const userName = settings.userName;

  if (!userName || userName.trim() === "" || userName.trim().toLowerCase() === "user") {
    return true;
  }

  return false;
}

function getSettings() {
  return loadSettings();
}

const getSystemPrompt = require('../config/system-prompt');

let currentSettings = null;

function getAPIInstance(apiKey, mode = 'text') {
  currentSettings = loadSettings();

  const genAI = new GoogleGenerativeAI(apiKey);

  const tools = [
    {
      googleSearch: {}
    }
  ];

  const servicesConfig = require('../config/services.config');

  const model = genAI.getGenerativeModel({
    model: currentSettings.modelName,
    systemInstruction: {
      parts: [{ text: getSystemPrompt(currentSettings.userName, mode) }]
    },
    tools: tools,
    generationConfig: servicesConfig.gemini.generationConfig
  });

  const chat = model.startChat({ history: [] });

  return { genAI, model, chat };
}

function initializeAPI() {
  userProfile.load();
  return keyPool.initialize();
}

function getErrorMessage(error) {
  const status = error.status || error.code;
  const message = error.message || "";

  if (status === 429 || message.includes("429") || message.includes("quota")) {
    return "Rate limit reached. Switching to next available key...";
  }

  if (message.includes("leaked") || message.includes("revoked") || message.includes("disabled")) {
    return "API key was reported as compromised. Trying next key...";
  }

  if (status === 401 || status === 403 || message.includes("API key")) {
    return "Invalid API key detected and removed. Trying next key...";
  }

  if (status >= 500) {
    return "Gemini connection error. Please try again later.";
  }

  return "Something went wrong. Please try again.";
}

async function sendQuery(query, image = null, mode = 'text') {
  // No need for mode prefix - we use separate system prompts for each mode

  const stats = keyPool.getStats();
  const maxRetries = Math.max(3, stats.gemini || 0);
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const apiKey = await keyPool.getNextKey('gemini');

    if (!apiKey) {
      break;
    }

    try {
      const { chat } = getAPIInstance(apiKey, mode);
      let result;

      if (image) {
        if (!image.startsWith('data:') || !image.includes(';base64,')) {
          result = await chat.sendMessage(query);
        } else {
          const base64Data = image.substring(image.indexOf(',') + 1);

          if (!base64Data) {
            result = await chat.sendMessage(query);
          } else {
            const match = image.match(/^data:([^;]+);base64,/);
            const mimeType = match ? match[1] : 'image/png';

            const imagePart = {
              inlineData: {
                data: base64Data,
                mimeType: mimeType
              }
            };
            result = await chat.sendMessage([query, imagePart]);
          }
        }
      } else {
        result = await chat.sendMessage(query);
      }

      const response = await result.response;
      const responseText = response.text();

      keyPool.reportSuccess('gemini', apiKey);

      try {
        await userProfile.addInteraction(query, responseText);
      } catch (profileErr) {
        logger.error(`Failed to record interaction: ${profileErr.message}`);
      }

      if (userProfile.shouldUpdate()) {
        triggerProfileUpdate(apiKey);
      }

      return responseText;

    } catch (error) {
      lastError = error;
      logger.error(`LLM error with key: ${error.message}`);

      keyPool.reportError('gemini', apiKey, error);

    }
  }

  if (lastError) {
    return `${getErrorMessage(lastError)}`;
  }

  return "No Gemini API keys available. Please check your internet or keys.";
}

function getPoolStats() {
  return keyPool.getStats();
}

function refreshKeyPool() {
  return keyPool.initialize();
}

async function triggerProfileUpdate(apiKey) {
  const prompt = userProfile.getUpdatePrompt();
  if (!prompt) return;

  userProfile.setUpdateInProgress();

  let key = null;
  try {
    key = apiKey || await keyPool.getNextKey('gemini');
    if (!key) {
      userProfile.updateSummary(null);
      return;
    }

    const genAI = new GoogleGenerativeAI(key);
    const servicesConfig = require('../config/services.config');

    const model = genAI.getGenerativeModel({
      model: currentSettings?.modelName || "gemini-2.5-flash-lite",
      generationConfig: {
        ...servicesConfig.gemini.generationConfig,
        maxOutputTokens: 300,
      },
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();

    userProfile.updateSummary(summary);
    keyPool.reportSuccess('gemini', key);
    logger.info("[LLM] User profile updated successfully");
  } catch (e) {
    logger.error(`Profile update failed: ${e.message}`);
    if (key) {
      keyPool.reportError('gemini', key, e);
    }
    userProfile.updateSummary(null);
  }
}

module.exports = {
  sendQuery,
  loadSettings,
  saveSettings,
  needsSetup,
  getSettings,
  initializeAPI,
  getPoolStats,
  refreshKeyPool,
};
