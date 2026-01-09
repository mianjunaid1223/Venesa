const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");
const os = require("os");

const SETTINGS_PATH = path.join(os.homedir(), ".Venesa-settings.json");

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
    } catch (e) {}
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
    systemInstruction: {
      parts: [
        {
          text: `You are Venesa, an AI-powered desktop search assistant for Windows. The user's name is ${currentSettings.userName}.

CRITICAL: You MUST use action commands for ANY request involving apps, files, or folders. Never just say "okay" or acknowledge - ALWAYS output the action command.

Action format (MUST use this exact format):
[action: actionName, paramName: value]

Available actions:

1. Launch applications: [action: launchApplication, appName: <name>]
   Examples: chrome, notepad, firefox, word, excel, calculator, settings, explorer, spotify, discord, slack, teams, outlook, code

2. Open files: [action: openFile, filePath: <path>]

3. Search for files/folders: [action: searchFiles, query: <search-term>]
   Use this when user wants to find, search, or locate any file or folder.

EXAMPLES - You MUST respond exactly like this:
- User: "open chrome" → You: [action: launchApplication, appName: chrome]
- User: "launch notepad" → You: [action: launchApplication, appName: notepad]
- User: "find my documents" → You: [action: searchFiles, query: documents]
- User: "search for photos" → You: [action: searchFiles, query: photos]
- User: "open file explorer" → You: [action: launchApplication, appName: explorer]
- User: "where is my resume" → You: [action: searchFiles, query: resume]

Rules:
- For app/file/folder requests: Output ONLY the action command, nothing else.
- For general questions: Answer briefly without action commands.
- NEVER say "okay", "sure", "I'll do that" - just output the action.
- Do not use markdown.
`,
        },
      ],
      role: "model",
    },
  });

  chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: "Hello" }],
      },
      {
        role: "model",
        parts: [
          { text: `Hello ${currentSettings.userName}! I am Venesa, your desktop search assistant.` },
        ],
      },
    ],
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

async function sendQuery(query) {
  if (!chat) {
    if (!initializeAPI()) {
      return "⚠️ API not configured. Click the gear icon to set up your API key.";
    }
  }

  try {
    const result = await chat.sendMessage(query);
    const response = await result.response;
    return response.text();
  } catch (error) {
    return `⚠️ ${getErrorMessage(error)}`;
  }
}

module.exports = { sendQuery, loadSettings, saveSettings, needsSetup, getSettings, initializeAPI };
