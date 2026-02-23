# Venesa Architecture

## System Overview

Venesa is an Electron-based voice and text assistant for Windows. It uses offline wake-word detection, cloud-based speech services, LLM-powered intent parsing, and a modular skill system to execute tasks through natural language.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Windows (src/platform/windows/)                            │ │
│  │  - Main Window     (search bar + AI responses)              │ │
│  │  - Voice Window    (full-screen overlay + karaoke)           │ │
│  │  - Setup Window    (first-run API key entry)                │ │
│  │  - Background      (hidden, wake-word detection)            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Brain (src/brain/)                                         │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │ LLM          │  │ Processor    │  │ Orchestrator │      │ │
│  │  │ (Gemini)     │──│ (parse tags) │──│ (plans)      │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │ System       │  │ Services     │  │ Memory       │      │ │
│  │  │ Prompt       │  │ Config       │  │ (persistent) │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Skills (src/skills/)                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │ Registry     │  │ Validator    │  │ Loader       │      │ │
│  │  │ (skill map)  │  │ (shape chk)  │  │ (auto-disc)  │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │ core/ — 30 skill modules                             │   │ │
│  │  │ (launchApp, searchFiles, systemControl, calculate...) │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Platform Services (src/platform/)                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │ STT          │  │ TTS          │  │ Wake-Word    │      │ │
│  │  │ (ElevenLabs) │  │ (ElevenLabs) │  │ (Vosk)       │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  │  ┌──────────────┐  ┌──────────────┐                         │ │
│  │  │ IPC Handlers │  │ Model Server │                         │ │
│  │  │ (4 modules)  │  │ (Vosk HTTP)  │                         │ │
│  │  └──────────────┘  └──────────────┘                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Libraries (src/lib/)                                       │ │
│  │  logger, key-pool, key-store, powershell, paths,            │ │
│  │  event-bus, pipeline                                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ IPC Communication
                            │
┌──────────────────────────────────────────────────────────────────┐
│                     RENDERER PROCESSES                            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐      │
│  │ Main Window    │  │ Voice Window   │  │ Background     │      │
│  │                │  │                │  │ Window         │      │
│  │ - Search UI    │  │ - Karaoke      │  │ - Audio Capture│      │
│  │ - Dynamic UI   │  │   subtitles    │  │ - Vosk Feed    │      │
│  │ - Google View  │  │ - Voice result │  │ (hidden)       │      │
│  │ - AI Responses │  │                │  │                │      │
│  └────────────────┘  └────────────────┘  └────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐      │
│  │ Vosk Model     │  │ ElevenLabs API │  │ Google Gemini  │      │
│  │ (Local)        │  │ (Cloud)        │  │ (Cloud)        │      │
│  └────────────────┘  └────────────────┘  └────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

## Directory Layout

```
src/
├── brain/                          # AI logic layer
│   ├── llm.js                     # Gemini API client, per-query chat sessions
│   ├── processor.js               # Parses LLM response → actions/plans/UI
│   ├── orchestrator.js            # Executes multi-step [plan] blocks
│   ├── system-prompt.js           # System prompts (voice & text modes)
│   ├── services.config.js         # LLM + TTS model/voice config
│   └── memory.js                  # Persistent memory store
│
├── skills/                         # Modular skill system
│   ├── registry.js                # Skill map — get(name), register(skill)
│   ├── validator.js               # Validates skill shape at load time
│   ├── loader.js                  # Auto-discovers & loads from core/
│   └── core/                      # 30 skill modules (one file each)
│       ├── _shared.js             # Common utilities (runPowerShell, paths)
│       ├── launch-app.js
│       ├── search-files.js
│       ├── system-control.js
│       ├── calculate.js
│       └── ... (26 more)
│
├── platform/                       # Electron platform layer
│   ├── main.js                    # App entry point, lifecycle, shortcuts
│   ├── model-server.js            # Local HTTP server for Vosk model
│   ├── formatters.js              # Result → text/voice formatting
│   ├── windows/                   # BrowserWindow factories
│   │   ├── main-window.js
│   │   ├── voice-window.js
│   │   ├── setup-window.js
│   │   └── background-window.js
│   ├── speech/                    # Speech services
│   │   ├── stt.js                 # ElevenLabs Scribe (speech-to-text)
│   │   ├── tts.js                 # ElevenLabs Flash v2.5 (text-to-speech)
│   │   └── wake-word.js           # Vosk wake-word management
│   ├── ipc/                       # IPC handler modules
│   │   ├── query-handlers.js      # Text query pipeline
│   │   ├── voice-handlers.js      # Voice query pipeline
│   │   ├── action-handlers.js     # Direct action execution
│   │   └── system-handlers.js     # System/settings IPC
│   └── preload/                   # Context bridge preloads
│       ├── main.preload.js
│       ├── voice.preload.js
│       └── background.preload.js
│
├── renderer/                       # UI (HTML + JS, no framework)
│   ├── main.window.html           # Search bar, AI responses, dynamic UI
│   ├── voice.window.html          # Full-screen voice overlay
│   ├── background.window.html     # Hidden audio capture window
│   ├── setup.window.html          # First-run setup wizard
│   ├── lib/                       # Client-side libraries (vosk.js)
│   └── workers/
│       └── audio.processor.js     # AudioWorklet for mic capture
│
└── lib/                            # Shared utilities
    ├── logger.js                  # File + console logger
    ├── key-pool.js                # API key rotation with failover
    ├── key-store.js               # Encrypted key storage
    ├── powershell.js              # Safe PowerShell execution
    ├── paths.js                   # App path resolution
    ├── event-bus.js               # Pub/sub event system
    └── pipeline.js                # Async pipeline helper
```

## Task Execution Pipeline

```
User Input (Voice or Text)
        │
        ▼
   LLM (Gemini)
   System prompt teaches [action:] and [plan] formats
        │
        ▼
  processor.processResponse()
   Detects response format
        │
   ┌────┴─────┐
   │          │
[plan]     [action:]
   │          │
   ▼          ▼
Orchestrator  Direct Skill
              Execution via Registry
   │
   ▼
Sequential Step Execution
   - Resolve $param references between steps
   - Apply execution markers (silently/announce/ask/confirm)
   - Skip steps on dependency failure
   - orchestrator.js obtains the skill via registry.get(...) and invokes skill.handler(resolvedParams) (the handler must handle errors and return a consistent result object)
   │
   ▼
Response Assembly
   - Determine UI component (from skill definition or LLM [ui:] tag)
   - Aggregate feedback per marker
   - Determine response mode (spoken/silent/ui)
   - Return clean response + results + dynamic UI
```

## Skill System

Each skill is a self-contained module in `src/skills/core/`. Skills are auto-discovered and validated at startup by the loader.

**Skill shape:**

```javascript
module.exports = {
    name: 'launchApp',
    description: 'Launch an application by name',
    params: ['appName'],
    ui: 'card-list',           // Optional: auto-rendered UI component
    handler: async (params) => { /* ... */ },
};
```

**Registered Skills (30):**

| Category | Skills |
|----------|--------|
| Apps | launchApp, closeApp, closeAllApps, listRunningApps |
| Files | searchFiles, openFile |
| Web | openUrl, googleSearch, youtubeSearch, getWeather |
| System | systemControl, getSystemInfo, getTime |
| Info | getNetworkInfo, getDiskInfo, getInstalledApps, listProcesses |
| Clipboard | getClipboard, setClipboard |
| Utilities | calculate, takeScreenshot, setReminder |
| Memory | setMemory, getMemory, manageCommands, listCommands, removeCommand |
| Advanced | runPowerShell, listen |

## Dynamic UI System

Skills can define a `ui` field that auto-triggers rich visual rendering when the skill executes. The LLM can also explicitly emit `[ui: component]` tags to override display.

| Component | Used By | Renders |
|-----------|---------|---------|
| `key-value` | getSystemInfo, getNetworkInfo, getDiskInfo | Two-column grid of label-value pairs |
| `card-list` | listRunningApps, getInstalledApps, searchFiles | Scrollable card list with icons and badges |
| `table` | listProcesses | Sortable data table with headers |
| `command-list` | listCommands | Styled command cards with trigger words |

**Priority:** LLM `[ui:]` tag > skill `ui` field > plain text fallback.

## Execution Markers

Each step in an orchestrated plan has a marker controlling user feedback:

| Marker | Behavior |
|--------|----------|
| `silently` | Execute without user notification |
| `announce` | Inform the user before/after execution |
| `ask` | Request clarification before proceeding |
| `confirm` | Require explicit user confirmation |

## Data Flow

### 1. Wake-Word Detection

```
User speaks "Venesa"
    ↓
[Background Window] Captures audio via Web Audio API
    ↓
[Vosk Model] Processes 16kHz audio stream locally
    ↓
[Pattern Matching] Matches variations (venesa, venessa, vanessa)
    ↓
[Main Process] IPC: wake-word-detected
    ↓
[Window Manager] Pauses detection, shows voice window
```

### 2. Voice Query

```
Voice window opens
    ↓
[AudioWorklet] Captures microphone input
    ↓
[STT Service] Voice Activity Detection (RMS > threshold)
    ↓
[VAD] Detects speech → Records → Detects 1.2s silence → Stops
    ↓
[ElevenLabs Scribe] Transcribes audio → Text
    ↓
[LLM] Processes with Gemini + system prompt
    ↓
[Processor] Parses [action:] tags or [plan] blocks
    ↓
[Orchestrator / Registry] Executes skills
    ↓
[TTS] Synthesizes response → Plays with karaoke subtitles
```

### 3. Text Query

```
User opens search bar (Alt+Space)
    ↓
User types query + Enter
    ↓
[Main Window] Checks prefix:
    - None → Search files/apps locally
    - /    → AI query via Gemini
    - //   → Google search
    ↓
[Processor] Parses response for actions/plans
    ↓
[Skill Execution] Results + Dynamic UI returned to renderer
```

## Key Design Decisions

### Stateless LLM Sessions
Each query creates a fresh Gemini chat session. No conversation history accumulates between queries. This ensures each interaction is independent and prevents topic bleed.

### Skill-Driven UI
Skills declare their own UI component via the `ui` field. The renderer auto-dispatches to the correct component without requiring the LLM to emit `[ui:]` tags. This makes UI display robust and consistent.

### Separation of Concerns
- **brain/** — pure AI logic (LLM, parsing, orchestration)
- **skills/** — task implementations (what the assistant can do)
- **platform/** — Electron-specific code (windows, IPC, speech)
- **lib/** — shared utilities (no Electron or AI dependencies)
- **renderer/** — UI (no Node.js, only preload bridges)

## Error Handling

- Per-skill try-catch in registry execution
- Dependency chain failure propagation (skip dependent steps)
- API key rotation with automatic failover on 401/403/429
- Microphone retry with exponential backoff
- IPC sender destruction checks before response

## Security

- PowerShell commands filtered against dangerous patterns (registry, credentials, obfuscation)
- Only whitelisted safe command patterns allowed
- Path normalization and home-directory restriction on file access
- URL schemes restricted to http/https
- Math calculator uses safe recursive-descent parser (no eval)
- Clipboard content privacy-masked in logs
- Preload script isolation with contextBridge (no nodeIntegration)

---

Built for reliability, performance, and maintainability.
