const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");
const os = require("os");

const SETTINGS_PATH = path.join(os.homedir(), ".spotlight-settings.json");

const DEFAULT_SETTINGS = {
  apiKey: "",
  modelName: "gemini-2.5-flash",
  userName: "User",
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, "utf8").trim();
      if (data) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }
    }
  } catch (error) {
    try {
      fs.unlinkSync(SETTINGS_PATH);
    } catch (e) { }
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    return false;
  }
}

function needsSetup() {
  const settings = loadSettings();
  return !settings.apiKey;
}

function getSettings() {
  return loadSettings();
}

let genAI = null;
let model = null;
let chat = null;
let currentSettings = null;

function initializeAPI() {
  currentSettings = loadSettings();

  if (!currentSettings.apiKey) {
    return false;
  }

  genAI = new GoogleGenerativeAI(currentSettings.apiKey);

  model = genAI.getGenerativeModel({
    model: currentSettings.modelName,
    parts: [
      {
        text: `You are Venesa, an advanced AI-powered desktop assistant for Windows. The user's name is ${currentSettings.userName}.
You have access to see the user's screen context effectively.

CRITICAL INSTRUCTIONS:
1. **Screen Context**: You may receive an image of the user's screen. **Only analyze or mention the screen content if the user explicitly asks** (e.g., "what is this?", "analyze this image", "help me with this code", "read this"). Otherwise, ignore the screen image and answer normally.
2. **Action Commands**: You MUST use action commands for ANY request involving apps, files, or folders.

Action format (MUST use this exact format):
[action: actionName, paramName: value]

Available actions:
1. Launch applications: [action: launchApplication, appName: <name>]
2. Open files: [action: openFile, filePath: <path>]
3. Search for files/folders: [action: searchFiles, query: <search-term>]

EXAMPLES:
- User: "open chrome" → You: [action: launchApplication, appName: chrome]
- User: "what's on my screen?" → You: "I see a browser window with..."
- User: "summarize this text" (with screen) → You: "The text discusses..."
- User: "hello" → You: "Hello! How can I help you today?"

Rules:
- Output actions for app/file requests.
- Be concise and helpful.
- Do not use markdown for actions.
`,
      },
    ],
    role: "model",
  });

  chat = model.startChat({
    history: [], // Clear history on init or keep simple
  });

  return true;
}

function getErrorMessage(error) {
  const status = error.status || error.code;
  const message = error.message || "";

  if (status === 429 || message.includes("429") || message.includes("quota")) {
    const retryMatch = message.match(/retry in ([\d.]+)/i);
    if (retryMatch) {
      const seconds = Math.ceil(parseFloat(retryMatch[1]));
      return `Rate limit reached. Please wait ${seconds} seconds and try again.`;
    }
    return "Rate limit reached. Please wait a moment and try again.";
  }

  if (status === 401 || status === 403 || message.includes("API key")) {
    return "Invalid API key. Please check your API key in settings.";
  }

  if (status === 404 || message.includes("not found")) {
    return "Model not found. Please check the model name in settings.";
  }

  if (message.includes("fetch") || message.includes("network") || message.includes("ENOTFOUND")) {
    return "Network error. Please check your internet connection.";
  }

  if (message.includes("safety") || message.includes("blocked")) {
    return "Response blocked by safety filters. Please try a different query.";
  }

  if (status >= 500) {
    return "Gemini server error. Please try again later.";
  }

  return "Something went wrong. Please try again.";
}

async function sendQuery(query, image = null) {
  if (!chat) {
    if (!initializeAPI()) {
      return "⚠️ API not configured. Click the gear icon to set up your API key.";
    }
  }

  try {
    let result;
    if (image) {
      // Image provided - extract base64
      const base64Data = image.split(',')[1];
      const mimeType = image.split(':')[1].split(';')[0];

      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      };

      // For multimodal requests, we might need a flash model.
      // Assuming 'gemini-1.5-flash' or similar which supports vision.
      // Current chat session might not support mix if init with text-only model?
      // Gemini 1.5/Pro supports it.

      result = await chat.sendMessage([query, imagePart]);
    } else {
      result = await chat.sendMessage(query);
    }

    const response = await result.response;
    return response.text();
  } catch (error) {
    // If chat gets corrupted or model issues, try single shot or refind
    console.error("Gemini Error:", error);
    return `⚠️ ${getErrorMessage(error)}`;
  }
}

module.exports = { sendQuery, loadSettings, saveSettings, needsSetup, getSettings, initializeAPI };
