# Venesa

<p align="center">
  <img src="assets/logo.png" alt="Venesa Logo" width="120" />
</p>

<p align="center">
  <strong>Intelligent Voice & Text Assistant for Windows</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-28.0-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/Gemini-2.5%20Flash%20Lite-4285F4?logo=google" alt="Gemini" />
  <img src="https://img.shields.io/badge/ElevenLabs-TTS%2FSTT-5436DA" alt="ElevenLabs" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

> **Download:** If you just want to use the app directly, you can download the installer here: [Venesa Setup 1.0.0.exe](./Venesa%20Setup%201.0.0.exe) - *Download and run to install immediately!*

---

## What is Venesa?

Venesa is a desktop AI assistant for Windows that combines voice and text interaction with intelligent task orchestration. Say "Hey Venesa" or press `Alt+Space` to launch, search, control, and automate your PC using natural language.

A single prompt like *"Set up my workspace"* will launch your apps, adjust your volume, and get everything ready — automatically.

**Core Capabilities:**

- Wake word detection ("Hey Venesa") via Vosk
- Speech-to-text via ElevenLabs Scribe
- Natural language understanding via Google Gemini 2.5 Flash Lite
- Text-to-speech via ElevenLabs
- File, app, and web search
- System controls (volume, brightness, lock, restart)
- Multi-step task orchestration from a single prompt
- Quick-access search bar (`Alt+Space`)

---

## Task Orchestration

Venesa doesn't just execute single commands — it intelligently chains multiple actions together from natural language.

### Single Actions

Simple requests use direct action execution:

| Prompt | Action |
|--------|--------|
| "Open Chrome" | Launches Chrome |
| "Find my resume" | Searches files |
| "What time is it?" | Returns current time |
| "Set volume to 50%" | Adjusts system volume |
| "Search Google for best laptops" | Opens Google search |

### Multi-Step Workflows

Complex requests are broken down into sequenced plans with dependency chaining:

| Prompt | What Happens |
|--------|-------------|
| "Search Google for what I copied" | Gets clipboard → Opens Google with that text |
| "Set up for work" | Launches VS Code, Chrome, Slack → Sets volume to 30% |
| "Close everything and lock my PC" | Closes all apps → Locks the computer |
| "What's eating my CPU and RAM?" | Fetches system info + top processes |
| "Search YouTube for lofi then Google for best IDE" | Opens both searches in sequence |

### Execution Markers

Each step in a workflow has a marker that controls feedback:

| Marker | Behavior |
|--------|----------|
| `silently` | Runs in the background — no spoken/text feedback |
| `announce` | Tells the user what's happening |
| `ask` | Requests clarification before proceeding |
| `confirm` | Asks for confirmation before destructive actions |

---

## Available Actions

| Category | Actions |
|----------|---------|
| **Apps** | Launch app, close app, close all apps, list running apps |
| **Files** | Search files/folders, open file |
| **Web** | Google search, YouTube search, open URL, weather lookup |
| **System** | Volume, brightness, WiFi/Bluetooth toggle, lock, sleep, restart, shutdown |
| **Info** | System info (CPU/RAM/battery), time, network info, disk info, installed apps |
| **Clipboard** | Read clipboard, write to clipboard |
| **Utilities** | Calculator, screenshot, reminders, list processes |
| **Advanced** | Run PowerShell commands (with safety filtering) |

---

## Project Structure

```
venesa/
├── src/
│   ├── main/
│   │   ├── main.js                  # Electron main process & IPC
│   │   └── preload/
│   │       ├── main.preload.js
│   │       ├── voice.preload.js
│   │       └── background.preload.js
│   ├── core/
│   │   ├── task-orchestrator.js      # Multi-step plan parser & executor
│   │   ├── task-registry.js          # Scalable task module registry
│   │   ├── task-service.js           # All task implementations (24 tasks)
│   │   ├── llm-service.js            # Gemini API integration
│   │   ├── elevenlabs-service.js     # TTS service
│   │   ├── stt-service.js            # Speech-to-text service
│   │   ├── wake-word-service.js      # Vosk wake word detection
│   │   ├── powershell-session.js     # Persistent PowerShell session
│   │   ├── user-profile.js           # Adaptive user profiling
│   │   ├── apiKeyPool.js             # API key rotation
│   │   ├── logger.js                 # Logging utility
│   │   └── paths.js                  # Path management
│   ├── config/
│   │   ├── system-prompt.js          # LLM system prompts (text & voice)
│   │   └── services.config.js        # Service configurations
│   └── renderer/
│       ├── main.window.html
│       ├── voice.window.html
│       ├── background.window.html
│       ├── setup.window.html
│       └── workers/
│           └── audio.processor.js
├── models/
│   └── vosk-model-small-en-us-0.15/
├── assets/
│   └── logo.png
├── .env
├── package.json
└── README.md
```

---

## Requirements

- Windows 10 or 11
- Node.js 18 or higher
- pnpm
- Google Gemini API key
- ElevenLabs API key

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/mianjunaid1223/Venesa.git
cd Venesa
pnpm install
```

### 2. Add API keys

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_key_here
GEMINI_API_KEY_1=optional_second_key

ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_API_KEY_1=optional_second_key
```

### 3. Run

```bash
pnpm start
```

For debug logging:

```bash
pnpm dev
```

---

## How to Use

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt + Space` | Open/close search bar |
| `Ctrl + Shift + V` | Open voice window |
| `Escape` | Close current window |
| `Enter` | Run selected action |
| `↑ / ↓` | Navigate results |

### Voice Mode

Say "Hey Venesa" to activate. The app will:
1. Show a listening indicator
2. Record and transcribe your speech
3. Send it to Gemini for processing
4. Execute any actions and speak the response

### Search Bar Modes

| Prefix | Mode | Example |
|--------|------|---------|
| *(none)* | Search files and apps | `notepad` |
| `/` | Ask Gemini | `/help me find my résumé` |
| `//` | Google search | `//weather today` |

### Example Prompts

**Simple commands:**
- "Open Chrome"
- "Find documents with budget"
- "What time is it?"
- "Set volume to 50%"
- "Close Discord"
- "What's the weather in London?"
- "Search YouTube for cooking tutorials"
- "What's 15% of 230?"
- "Remind me in 60 seconds to stretch"
- "Take a screenshot"

**Multi-step workflows:**
- "Search Google for what I copied"
- "Set up my workspace for coding"
- "Close everything and lock my PC"
- "What's eating my CPU and RAM?"
- "Search YouTube for lofi then Google for best IDE"

---

## Architecture

```
User Input (Voice / Text)
        │
        ▼
   LLM (Gemini)  ←── System Prompt teaches action & plan formats
        │
        ▼
  processResponse()  ←── Detects [plan]...[/plan] or [action:]
        │
   ┌────┴────┐
   │         │
[plan]    [action:]     ← backward compatible
   │         │
   ▼         ▼
Orchestrator    Direct Task Execution
   │              via Task Registry
   ▼
Sequential Step Execution
  • Resolve $param references
  • Apply execution markers
  • Skip on dependency failure
  • Registry.execute() per step
```

### Key Components

| Component | Role |
|-----------|------|
| **Task Registry** | Central registry of all 24 task capabilities with metadata. New tasks added via `registry.register()` |
| **Task Orchestrator** | Parses `[plan]...[/plan]` blocks, resolves parameter dependencies (`$getClipboard`), manages execution markers |
| **Task Service** | Implements all task handlers — app launching, file search, system control, web search, calculator, etc. |
| **LLM Service** | Manages Gemini API communication with key rotation and profile learning |
| **System Prompt** | Teaches the LLM how to output structured actions and multi-step plans |

---

## Configuration

Settings are stored in `~/.venesa-settings.json`:

```json
{
  "modelName": "gemini-2.5-flash-lite",
  "userName": "User"
}
```

### Voice Settings

Edit `src/config/services.config.js` to change TTS/LLM settings:

```javascript
elevenlabs: {
  model: 'eleven_flash_v2_5',
  voiceId: 'pFZP5JQG7iQjIQuC4Bku',
  outputFormat: 'mp3_44100_128',
},
gemini: {
  model: 'gemini-2.5-flash-lite-preview-06-17',
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 500,
  },
}
```

---

## API Key Rotation

Both Google and ElevenLabs support multiple keys. The app automatically:

- Rotates between available keys
- Switches keys when rate limited (429 errors)
- Skips keys that return errors

Add keys with incrementing numbers: `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc.

---

## Security

- PowerShell commands are filtered against dangerous patterns (registry edits, credential access, etc.)
- Only whitelisted safe commands are allowed
- Path traversal checks on file operations
- URL schemes restricted to `http` and `https`
- Math calculator uses a safe recursive-descent parser (no `eval`)
- Clipboard content is privacy-masked in logs

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop framework | Electron 28 |
| Language model | Google Gemini 2.5 Flash Lite |
| Speech-to-text | ElevenLabs Scribe |
| Text-to-speech | ElevenLabs Flash v2.5 |
| Wake word | Vosk |
| Audio | Web Audio API, AudioWorklet |
| System integration | PowerShell |
| Task orchestration | Custom registry + orchestrator |

---

## Troubleshooting

### Wake word not working

1. Check microphone permissions in Windows Settings
2. Make sure the Vosk model exists in `models/vosk-model-small-en-us-0.15/`
3. Close other apps that might be using the microphone
4. Restart the app

### Speech-to-text or text-to-speech errors

1. Check your ElevenLabs API key in `.env`
2. Check your quota at [elevenlabs.io/app](https://elevenlabs.io/app)
3. Run with `pnpm dev` to see error details

### Gemini errors

1. Check your Google API key in `.env`
2. Make sure the key has Gemini API access enabled
3. If you see 429 errors, add more keys for rotation

### Voice window not responding

1. Press Escape to close, then Ctrl+Shift+V to reopen
2. Check console for errors with `pnpm dev`

---

## Adding New Tasks

The task system is modular. To add a new task:

1. **Implement the handler** in `task-service.js`:
   ```javascript
   async function myNewTask(params) {
     // your logic here
     return "result";
   }
   ```

2. **Register it** in `registerAllTasks()`:
   ```javascript
   registry.register('myNewTask', (p) => myNewTask(p.param1), {
     description: 'What this task does',
     params: ['param1'],
     tags: ['category'],
     marker: 'announce',
   });
   ```

3. **Add to the system prompt** in `system-prompt.js` so the LLM knows about it.

That's it — the orchestrator will automatically be able to include it in multi-step plans.

---

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push (`git push origin my-feature`)
5. Open a pull request

---

## License

MIT License. See [LICENSE](LICENSE).

---

## Credits

- [Electron](https://www.electronjs.org/)
- [Google Gemini](https://ai.google.dev/)
- [ElevenLabs](https://elevenlabs.io/)
- [Vosk](https://alphacephei.com/vosk/)

---

<p align="center">
  Made by <a href="https://github.com/mianjunaid1223">mianjunaid1223</a>
</p>
