const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");
const os = require("os");
const logger = require('./logger');
const keyPool = require("./apiKeyPool");

const SETTINGS_PATH = path.join(os.homedir(), ".venesa-settings.json");

const DEFAULT_SETTINGS = {
  modelName: "gemini-2.5-flash",
  userName: "User",
  openAtLogin: true,
};

const apiInstances = new Map();

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

function getAPIInstance(apiKey) {
  if (apiInstances.has(apiKey)) {
    return apiInstances.get(apiKey);
  }

  currentSettings = loadSettings();

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: currentSettings.modelName,
    systemInstruction: {
      parts: [{ text: getSystemPrompt(currentSettings.userName) }]
    }
  });

  const chat = model.startChat({ history: [] });

  const instance = { genAI, model, chat };
  apiInstances.set(apiKey, instance);

  return instance;
}

function initializeAPI() {
  apiInstances.clear();
  return keyPool.initialize();
}

function getErrorMessage(error) {
  const status = error.status || error.code;
  const message = error.message || "";

  if (status === 429 || message.includes("429") || message.includes("quota")) {
    return "Rate limit reached. Switching to next available key...";
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
  const contextualQuery = mode === 'voice'
    ? `[USER SPOKE VIA VOICE] ${query}`
    : `[USER TYPED IN TEXT MODE] ${query}`;

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const apiKey = await keyPool.getNextKey('gemini');

    if (!apiKey) {
      break;
    }

    try {
      const { chat } = getAPIInstance(apiKey);
      let result;

      if (image) {
        if (!image.startsWith('data:') || !image.includes(';base64,')) {
          result = await chat.sendMessage(contextualQuery);
        } else {
          const base64Data = image.substring(image.indexOf(',') + 1);

          if (!base64Data) {
            result = await chat.sendMessage(contextualQuery);
          } else {
            const match = image.match(/^data:([^;]+);base64,/);
            const mimeType = match ? match[1] : 'image/png';

            const imagePart = {
              inlineData: {
                data: base64Data,
                mimeType: mimeType
              }
            };
            result = await chat.sendMessage([contextualQuery, imagePart]);
          }
        }
      } else {
        result = await chat.sendMessage(contextualQuery);
      }

      const response = await result.response;
      return response.text();

    } catch (error) {
      lastError = error;
      logger.error(`LLM error with key: ${error.message}`);

      keyPool.reportError('gemini', apiKey, error);
      apiInstances.delete(apiKey);
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
  apiInstances.clear();
  return keyPool.initialize();
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
