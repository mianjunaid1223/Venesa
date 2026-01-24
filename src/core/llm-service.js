const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Import the API Key Pool Manager
const keyPool = require("./apiKeyPool");

const SETTINGS_PATH = path.join(os.homedir(), ".venesa-settings.json");

const DEFAULT_SETTINGS = {
  modelName: "gemini-2.5-flash",
  userName: "User",
  openAtLogin: true,
};

// Track current API instances per key
const apiInstances = new Map();

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, "utf8").trim();
      if (data) {
        const saved = JSON.parse(data);
        const settings = { ...DEFAULT_SETTINGS, ...saved };

        // Final guard: Ensure modelName is never empty
        if (!settings.modelName || settings.modelName.trim() === "") {
          settings.modelName = DEFAULT_SETTINGS.modelName;
        }

        return settings;
      }
    }
  } catch (error) {
    console.error("[LLM] Load settings error:", error);
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
    console.error("[LLM] Save settings error:", error);
    return false;
  }
}

function needsSetup() {
  // Initialize key pool if not already done
  if (!keyPool.isHealthy()) {
    keyPool.initialize();
  }
  // Setup is needed only if no API keys are available
  return !keyPool.isHealthy();
}

function getSettings() {
  return loadSettings();
}

let currentSettings = null;

/**
 * Get or create a chat instance for a specific API key
 * @param {string} apiKey - The API key to use
 * @returns {Object} Object with genAI, model, and chat instances
 */
function getAPIInstance(apiKey) {
  if (apiInstances.has(apiKey)) {
    return apiInstances.get(apiKey);
  }

  currentSettings = loadSettings();

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: currentSettings.modelName,
    systemInstruction: {
      parts: [
        {
          text: `# VENESA - WINDOWS AI ASSISTANT

You are **Venesa**, a voice/text AI assistant for ${currentSettings.userName} on Windows.

## CORE RULES
- **MAX 2 sentences** - Be extremely concise
- **NO MARKDOWN** - Plain text only, no **, *, formatting
- **NO FLUFF** - Never say "Sure!", "I can help", "Here is", etc.
- **ANNOUNCE ACTIONS** - Always tell the user what you're doing

## ACTION COMMANDS (USE THESE!)

You MUST use these action tags when the user wants to do something on their computer:

### 1. SEARCH for files, apps, or folders
\`[action: searchFiles, query: <search term>]\`

USE THIS WHEN:
- "find my documents" → [action: searchFiles, query: documents]
- "where is Chrome" → [action: searchFiles, query: Chrome]
- "look for report.pdf" → [action: searchFiles, query: report.pdf]
- "search for photos" → [action: searchFiles, query: photos]
- "find notes" → [action: searchFiles, query: notes]

RESPONSE: "Searching for [term]." followed by the action tag.

### 2. LAUNCH an application
\`[action: launchApplication, appName: <name>]\`

USE THIS WHEN:
- "open Chrome" → [action: launchApplication, appName: Chrome]
- "launch Notepad" → [action: launchApplication, appName: Notepad]
- "start VS Code" → [action: launchApplication, appName: Visual Studio Code]

RESPONSE: "Opening [app name]." followed by the action tag.

### 3. OPEN a file
\`[action: openFile, filePath: <path>]\`
Use relative path from home folder.

### 4. LISTEN AGAIN (CRITICAL!)
\`[action: listen]\`

USE THIS WHEN:
- You asked the user a question and need their response
- The speech was unclear or empty
- You need follow-up information
- User said something that needs clarification

EXAMPLES:
- After asking "Which one do you want?" → MUST include [action: listen]
- After "I didn't catch that" → MUST include [action: listen]
- After "Could you repeat that?" → MUST include [action: listen]
- After any question to the user → MUST include [action: listen]

RESPONSE FORMAT: "I didn't catch that. [action: listen]" or "Which file? [action: listen]"

### 5. SYSTEM CONTROLS
\`[action: systemControl, command: <cmd>, value: <0-100>]\`
Commands: volumeUp, volumeDown, volumeMute, setVolume, brightnessUp, brightnessDown, setBrightness, wifiToggle, bluetoothToggle, shutdown, restart, sleep, lock, emptyTrash, openSettings

### 6. OPEN URL
\`[action: openUrl, url: <url>]\`

### 7. GET SYSTEM INFO
\`[action: getSystemInfo]\`
Use only when user asks about overall PC status.

## EXAMPLES OF CORRECT RESPONSES

User: "find my resume"
Searching for your resume. [action: searchFiles, query: resume]

User: "open Chrome"
Opening Chrome. [action: launchApplication, appName: Chrome]

User: "where are my photos"
Looking for photos. [action: searchFiles, query: photos]

User: (unclear/garbled speech)
I didn't catch that. Could you say that again? [action: listen]

User: "set volume to 50"
Setting volume to 50. [action: systemControl, command: setVolume, value: 50]

User: "what time is it"
It's 9:46 PM.

## VOICE vs TEXT MODE

You'll see [USER SPOKE VIA VOICE] or [USER TYPED IN TEXT MODE] at the start.
- VOICE: Use spoken numbers ("nine forty-six"), more natural
- TEXT: Use digits ("9:46 PM"), ultra-concise

## IMAGE HANDLING

Only reference screen images if user asks about what's on screen. Otherwise ignore.

## REMEMBER

1. **ALWAYS use action tags** when user wants to find, open, or control something
2. **ALWAYS announce** what you're doing ("Opening...", "Searching for...")
3. **ALWAYS include [action: listen]** after asking questions or when speech is unclear
4. Keep responses SHORT
5. User name: ${currentSettings.userName}`,
        },
      ],
    },
  });

  const chat = model.startChat({
    history: [],
  });

  const instance = { genAI, model, chat };
  apiInstances.set(apiKey, instance);

  return instance;
}

function initializeAPI() {
  // Initialize the key pool from .env
  const initialized = keyPool.initialize();

  // Clear cached instances to ensure new settings (like modelName) are picked up
  apiInstances.clear();

  if (!initialized) {
    return false;
  }

  currentSettings = loadSettings();
  return true;
}

function getErrorMessage(error) {
  const status = error.status || error.code;
  const message = error.message || "";

  if (status === 429 || message.includes("429") || message.includes("quota")) {
    const retryMatch = message.match(/retry in ([\d.]+)/i);
    if (retryMatch) {
      const seconds = Math.ceil(parseFloat(retryMatch[1]));
      return `Rate limit reached. Trying another key... (wait ${seconds}s if all keys exhausted)`;
    }
    return "Rate limit reached. Switching to next available key...";
  }

  if (status === 401 || status === 403 || message.includes("API key")) {
    return "Invalid API key detected and removed. Trying next key...";
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

/**
 * Send a query to the Gemini API with automatic key rotation and failover
 * @param {string} query - The user's query
 * @param {string|null} image - Optional base64 image data
 * @param {string} mode - Input mode: 'voice' or 'text'
 * @returns {Promise<string>} The AI response
 */
async function sendQuery(query, image = null, mode = 'text') {
  // Ensure pool is initialized
  if (!keyPool.isHealthy()) {
    if (!initializeAPI()) {
      return "No API keys configured. Add keys to the .env file.";
    }
  }

  // Add mode context to query for AI awareness
  const contextualQuery = mode === 'voice'
    ? `[USER SPOKE VIA VOICE] ${query}`
    : `[USER TYPED IN TEXT MODE] ${query}`;

  const maxRetries = keyPool.getAvailableKeyCount();
  let lastError = null;

  // Try up to the number of available keys
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const apiKey = keyPool.getNextKey();

    if (!apiKey) {
      break; // No more keys available
    }

    try {
      const { chat } = getAPIInstance(apiKey);
      let result;

      if (image) {
        // Validate image is a proper data URL
        if (!image.startsWith('data:') || !image.includes(';base64,')) {
          console.error('[LLM] Invalid image data URL format');
          throw new Error('Invalid image format - must be a data URL');
        }

        // Extract base64 data and mime type safely
        const commaIndex = image.indexOf(',');
        if (commaIndex === -1) {
          throw new Error('Invalid image format - missing base64 data');
        }

        const base64Data = image.substring(commaIndex + 1);
        const mimeMatch = image.match(/^data:([^;]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

        if (!base64Data) {
          throw new Error('Invalid image format - empty base64 data');
        }

        const imagePart = {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        };

        result = await chat.sendMessage([contextualQuery, imagePart]);
      } else {
        result = await chat.sendMessage(contextualQuery);
      }

      const response = await result.response;
      const text = response.text();

      // Report success to the pool
      keyPool.reportSuccess(apiKey);

      return text;

    } catch (error) {
      lastError = error;

      // Report error to the pool - it handles rate limits and invalid keys
      const errorResult = keyPool.reportError(apiKey, error);

      // If it's not a key-related error, don't retry with another key
      if (!errorResult.keyHandled) {
        break;
      }

      // Remove the failed instance so we create a fresh one next time
      apiInstances.delete(apiKey);

      // Continue to try the next key
    }
  }

  // All keys exhausted or non-recoverable error
  if (lastError) {
    return `${getErrorMessage(lastError)}`;
  }

  return "All API keys are temporarily unavailable. Please wait and try again.";
}

/**
 * Get the current status of the API key pool
 * @returns {Object} Pool statistics
 */
function getPoolStats() {
  return keyPool.getStats();
}

/**
 * Manually refresh the key pool (re-read from .env)
 * @returns {boolean} True if refresh was successful
 */
function refreshKeyPool() {
  apiInstances.clear(); // Clear all cached instances
  return keyPool.refresh();
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
