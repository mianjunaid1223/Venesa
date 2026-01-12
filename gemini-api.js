const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Import the API Key Pool Manager
const keyPool = require("./src/shared/apiKeyPool");

const SETTINGS_PATH = path.join(os.homedir(), ".venesa-settings.json");

const DEFAULT_SETTINGS = {
  modelName: "gemini-2.5-flash",
  userName: "User",
};

// Track current API instances per key
const apiInstances = new Map();

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
let currentKey = null;
let currentChat = null;

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
          text: `You are Venesa, an intelligent voice assistant for Windows. User: ${currentSettings.userName}.

RESPONSE RULES - STRICTLY ENFORCED:
1. Maximum 3 sentences per response. Be concise and direct.
2. Plain text only. Never use markdown, bullet points, asterisks, or formatting.
3. No follow-up questions. Complete the task or provide the answer.
4. No conversational fluff. Skip greetings, "Sure!", "Of course!", "I'd be happy to".
5. No explanations unless specifically asked. Just do or answer.

UNCLEAR SPEECH HANDLING:
- If the user's message is garbled, incomplete, or doesn't make sense, politely ask for clarification.
- Examples: "I didn't quite catch that. Could you say that again?", "I'm not sure what you mean. Can you rephrase?", "Sorry, I didn't understand. What would you like me to do?"
- Do NOT try to guess or use the screen when the intent is unclear.

SCREEN IMAGE HANDLING:
- A screen capture may be attached but IGNORE it unless user EXPLICITLY asks about the screen.
- Never comment on, describe, or reference the screen image unless directly asked.
- Only use the image for explicit requests like: "what's on my screen", "read this", "what app is this"
- For unclear speech or random words, ask for clarification - do NOT analyze the screen.

ACTION COMMANDS (use exact format when user wants to launch/open/search):
[action: launchApplication, appName: <name>]
[action: openFile, filePath: <path>]
[action: searchFiles, query: <term>]

EXAMPLE RESPONSES:
User: "open chrome" → [action: launchApplication, appName: chrome]
User: "what's on my screen?" → (uses image) "You have VS Code open with a JavaScript file."
User: "what time is it in Tokyo?" → "It's currently 3:45 PM in Tokyo."
User: "asdf hello random" → "I didn't quite catch that. Could you say that again?"
User: "thanks" → "Done."

You are efficient, knowledgeable, and get straight to the point.`,
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

  if (!initialized) {
    console.error("[GeminiAPI] Failed to initialize - no API keys available");
    return false;
  }

  currentSettings = loadSettings();
  console.log(`[GeminiAPI] Initialized with ${keyPool.getAvailableKeyCount()} available keys`);
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
 * @returns {Promise<string>} The AI response
 */
async function sendQuery(query, image = null) {
  // Ensure pool is initialized
  if (!keyPool.isHealthy()) {
    if (!initializeAPI()) {
      return "⚠️ No API keys configured. Add keys to the .env file.";
    }
  }

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
        // Image provided - extract base64
        const base64Data = image.split(',')[1];
        const mimeType = image.split(':')[1].split(';')[0];

        const imagePart = {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        };

        result = await chat.sendMessage([query, imagePart]);
      } else {
        result = await chat.sendMessage(query);
      }

      const response = await result.response;
      const text = response.text();

      // Report success to the pool
      keyPool.reportSuccess(apiKey);

      return text;

    } catch (error) {
      console.error(`[GeminiAPI] Error with key attempt ${attempt + 1}:`, error.message);
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
      console.log(`[GeminiAPI] Trying next key (${keyPool.getAvailableKeyCount()} remaining)...`);
    }
  }

  // All keys exhausted or non-recoverable error
  if (lastError) {
    return `⚠️ ${getErrorMessage(lastError)}`;
  }

  return "⚠️ All API keys are temporarily unavailable. Please wait and try again.";
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
