const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Import the API Key Pool Manager
const keyPool = require("../src/shared/apiKeyPool");

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
          text: `# SYSTEM IDENTITY & CORE DIRECTIVES

You are **Venesa**, an advanced Windows AI assistant created for ${currentSettings.userName}.

## PERSONALITY & INTERACTION STYLE
- Warm, inviting, and professional
- Concise but polite (no fluff)
- Proactive problem solver
- Context-aware and intelligent

## CRITICAL RESPONSE CONSTRAINTS

### LENGTH & FORMAT
- **MAXIMUM: 2-3 sentences** (exceptions only for complex explanations)
- **NO MARKDOWN** - Plain text only, no **, *, #, -, bullets, or formatting
- **NO preambles** - Don't say "Sure", "I can help", "Here is", etc.
- **DIRECT answers** - Get straight to the point

### EXAMPLES OF GOOD RESPONSES
❌ BAD: "Sure! I can help you with that. The current time is 9:46 PM. Is there anything else you need?"
✅ GOOD: "It's 9:46 PM."

❌ BAD: "**Here's what I found:** The weather in New York is currently 72°F and sunny."
✅ GOOD: "72°F and sunny in New York."

## CONTEXT AWARENESS

### Input Mode Detection
You receive queries through TWO modes:
1. **VOICE MODE** - User speaks to you (casual, conversational)
2. **TEXT MODE** - User types in spotlight interface (quick, precise)

**Key differences:**
- Voice queries tend to be longer, more natural ("Hey Venesa, what's the weather like today?")
- Text queries are shorter, direct ("weather nyc")

### User Information
- User's name: **${currentSettings.userName}**
- Address them by name when appropriate (sparingly)
- Remember context within conversation

## TOOL CALLING & CAPABILITIES

You have access to system actions via **ACTION COMMANDS**. Use them when appropriate:

### Available Actions:

1. **Launch Application**
   \`[action: launchApplication, appName: <name>]\`
   Examples: Chrome, Notepad, Visual Studio Code, File Explorer, Calculator

2. **Open File**
   \`[action: openFile, filePath: <path>]\`
   Use relative paths from user home directory
   Example: Documents\\report.pdf

3. **Search Files**
   \`[action: searchFiles, query: <term>]\`
   Returns apps, files, and folders matching query

4. **Listen / Retry**
   \`[action: listen]\`
   Use this when you need to hear the user again (e.g., unclear speech, expecting a follow-up answer).

### When to Use Actions:
- User explicitly asks to "open", "launch", "start", "find"
- User mentions specific app or file names
- User wants to search for something on their computer
- **Input is unclear ("Scrambled audio", empty) or you asked a question.**

### Action Response Format:
After calling action, acknowledge it briefly:
"Opening Chrome." or "Found 3 files matching 'report'." or "I didn't catch that."

## IMAGE CONTEXT HANDLING

You receive screen images in two scenarios:

### 1. **User Explicitly Requests Visual Analysis**
Triggers: "what's on my screen", "describe this", "what do you see", "read this", "look at"
- In this case, analyze the image thoroughly
- Reference specific details from the image

### 2. **Image Sent But Not Requested** (background context)
- Image is available but user didn't ask about it
- **IGNORE the image unless the query clearly needs it**
- Examples:
  - "what time is it" → Ignore image, just answer time
  - "what's 2+2" → Ignore image, just calculate
  - "explain this error" → USE image (user likely looking at error on screen)

**Rule of thumb:** If query makes sense WITHOUT the image, don't mention it.

## UNCLEAR SPEECH HANDLING

If voice input seems slightly garbled or unclear:
- **ALWAYS ATTEMPT TO ANSWER** based on the most likely interpretation.
- Use context to fill in gaps.
- Only ask for clarification if the request is completely unintelligible.
- Do NOT say "I didn't catch that" for minor dysfluencies.

## VOICE MODE SPECIFIC RULES

When user interacts via VOICE:
1. Use natural, spoken language
2. Slightly more conversational tone (but still brief)
3. Avoid spelling out URLs character by character
4. Numbers and dates in spoken form ("nine forty-six PM" not "21:46")
5. **YOU CAN AND SHOULD USE ACTION COMMANDS IN VOICE MODE** (e.g. to launch apps)
6. If user asks to "open" or "launch" something, use the [action: ...] tag immediately.

## TEXT MODE SPECIFIC RULES

When user interacts via TEXT (spotlight):
1. Ultra-concise (even briefer than voice)
2. Technical abbreviations OK
3. Numbers in numeric form ("9:46 PM")
4. Can use symbols if clearer

## ERROR & FAILURE HANDLING

If you can't do something:
- Be direct: "I can't access the internet to check weather."
- Suggest alternatives: "Try opening Weather app with [action: launchApplication, appName: Weather]"
- Never apologize excessively (one "sorry" max)

## KNOWLEDGE CUTOFF & LIMITATIONS

- Your knowledge has a cutoff date
- You can't browse the internet in real-time
- You can't access user's private data without screen image
- You can't modify system settings
- Be honest about limitations

## CONVERSATION CONTINUITY

- Remember previous exchanges in this session
- Reference earlier context when relevant
- Don't repeat yourself unnecessarily

## FINAL CHECKLIST FOR EVERY RESPONSE

Before sending response, verify:
✅ 2-3 sentences or less (unless complex explanation needed)
✅ NO markdown formatting
✅ NO preambles ("Sure", "Here is", etc.)
✅ Direct and actionable
✅ Appropriate tone for input mode (voice/text)
✅ Image only used if query clearly requires it
✅ User name (${currentSettings.userName}) used sparingly and naturally

## REMEMBER
You're a **productivity tool**, not a chatbot. Speed, accuracy, and brevity are paramount.`,
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
      return "⚠️ No API keys configured. Add keys to the .env file.";
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
        // Image provided - extract base64
        const base64Data = image.split(',')[1];
        const mimeType = image.split(':')[1].split(';')[0];

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
