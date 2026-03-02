# Architecture Manual

## Overview

Venesa is a **programmable intelligence platform** for Windows built on Electron. It diverges from chatbot designs by treating the language model as a decision-making engine: the model produces structured protocol output that the runtime parses and executes as system-level operations. All components communicate through a unified protocol, and no component formats or re-interprets the model's output independently.

**Version:** 2.0.0  
**Target Platform:** Windows 10 / 11 (x64)  
**Runtime:** Electron 28, Node.js ≥ 18  
**Primary Model:** Google Gemini 2.5  
**Speech Stack:** Vosk (offline wake-word / local STT) + ElevenLabs Scribe (cloud STT) + ElevenLabs Flash v2.5 (TTS)

## Processing Pipeline

```text
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐
│  User Input  │───▶│ Context / Memory│───▶│  LLM Engine  │───▶│ Protocol Parser  │───▶│ Skill Executor│
│ (text/voice) │    │   Resolution    │    │  (Gemini 2.5)│    │  (processor.js)  │    │ (orchestrator)│
└──────────────┘    └─────────────────┘    └──────────────┘    └──────────────────┘    └───────────────┘
                                                                                                │
                                                                         ┌──────────────────────┤
                                                                         ▼                      ▼
                                                                  ┌────────────┐       ┌──────────────┐
                                                                  │ TTS Engine │       │  UI Pipeline │
                                                                  │(ElevenLabs)│       │  (renderer)  │
                                                                  └────────────┘       └──────────────┘
```

### Stage Breakdown

1. **Input Ingestion** — Audio captured by the Vosk wake-word detector triggers the speech pipeline. The audio is then routed to ElevenLabs Scribe (cloud STT) for high-accuracy transcription, or handled locally by the Vosk engine as a fallback. Text queries arrive directly through the main window IPC channel.

2. **Context Resolution** — Before the model is invoked, `system-prompt.js` assembles a full context object: user preferences, memory buckets (aliases, reminders, preferences), the active skill registry's metadata (`registry.getMetadataForPrompt()`), and conversation history from `memory.js`.

3. **Reasoning Engine** — `llm.js` sends the context + user query to Gemini 2.5. The model is constrained by the system-prompt to respond using Venesa's protocol tokens. Supports streaming responses. Handles multi-key rotation via `lib/key-pool.js` to recover gracefully from rate-limit events.

4. **Protocol Parser** — `processor.js` acts as an AST-style parser: it extracts `[speak]`, `[silent]`, `[ui]`, `[action:]`, and `[plan]` blocks from the raw response before any content reaches the UI or skill layer.

5. **Skill Executor** — Individual `[action:]` tags are dispatched directly to the matching registered skill. `[plan]` blocks are handed to `orchestrator.js`, which executes steps serially, resolving inter-step variable references.

6. **Output** — `[speak]` text is piped to TTS. `[ui]` markdown blocks are forwarded through `ui-pipeline.js` to the renderer for GitHub-style rendering. Plain text is streamed to the chat interface.

### Protocol Tokens vs Execution Markers

The architecture explicitly differentiates between **Reasoning Tokens** (how the AI shapes data) and **Execution Markers** (how the orchestrator surfaces progress).

| Token | Purpose | Execution Handling |
|---|---|---|
| `[speak]...[/speak]` | Exact string sent to TTS | Not tracked as an execution step |
| `[silent]...[/silent]` | Hides internal reasoning | Actions inside still parse and run |
| `[action: tool, param: value]` | Invokes a single atomic skill | Inherits the skill's default marker |
| `[plan]...[/plan]` | Serialized multi-step workflow | Parsed by `orchestrator.js` |
| `[step: tool, marker: silently]` | Plan step — background | No UI feedback or notification |
| `[step: tool, marker: announce]` | Plan step — verbose | Result shown in UI / spoken aloud |
| `[step: tool, marker: confirm]` | Plan step — gated | Execution paused until user confirms |
| `[ui]...[/ui]` | Rich markdown payload | Forwarded as a UI directive to renderer |

---

## Core Module Structure

```text
src/
├── brain/                       # Intelligence core
│   ├── protocol.js              # Single source of truth: RETURN_TYPES, EXECUTION_MARKERS, UI_COMPONENTS, LIFECYCLE_HOOKS
│   ├── llm.js                   # Gemini API client; handles streaming, key rotation, session management
│   ├── processor.js             # Protocol parser: extracts [speak], [silent], [ui], [action:], [plan] blocks
│   ├── orchestrator.js          # Plan executor: lexes [step:] tags, resolves $variables, runs serial steps
│   ├── system-prompt.js         # Builds the full LLM context from memory + skill registry
│   ├── memory.js                # Persists/retrieves named buckets (preferences, history, aliases) to disk
│   ├── services.config.js       # Third-party service configuration (ElevenLabs, Vosk endpoints)
│   └── settings.js              # User preference schema definitions and default values
│
├── skills/                      # Capability execution environment
│   ├── registry.js              # In-memory skill map; builds prompt metadata; manages enable/disable state
│   ├── loader.js                # Auto-discovers core/ and ~/.venesa/capabilities/; fires lifecycle hooks
│   ├── validator.js             # Validates capability shape against protocol; enforces Zod schemas at boundary
│   ├── core/                    # Built-in capabilities (always loaded, cannot be removed)
│   │   ├── _shared.js           # Shared utilities for core capabilities
│   │   ├── launch-app.js        # Launches applications via Windows Shell
│   │   ├── close-app.js         # Closes running applications by name/PID
│   │   ├── close-all-apps.js    # Terminates all non-critical running applications
│   │   ├── system-control.js    # Volume, brightness, power, network controls
│   │   ├── window-manager.js    # Minimize, maximize, snap, focus windows
│   │   ├── clipboard.js         # Read/write system clipboard
│   │   ├── clipboard-history.js # Retrieve recent clipboard entries
│   │   ├── file-ops.js          # File create, move, copy, delete (sandboxed paths)
│   │   ├── search-files.js      # Local file system search
│   │   ├── open-file.js         # Open files with their default application
│   │   ├── open-url.js          # Open URLs in the default browser
│   │   ├── google-search.js     # Perform Google searches from the assistant
│   │   ├── run-powershell.js    # Execute sandboxed PowerShell scripts
│   │   ├── take-screenshot.js   # Capture screen regions or full desktop
│   │   └── set-reminder.js      # Schedule in-app reminders
│   └── internal/                # Internal meta-skills (not injected into system prompt)
│       ├── get-chat-history.js  # Retrieves conversation history
│       ├── get-memory.js        # Reads memory buckets
│       ├── set-memory.js        # Writes to memory buckets
│       ├── list-commands.js     # Lists available capabilities
│       ├── listen.js            # Triggers active listening mode
│       ├── manage-commands.js   # Enable/disable capability state
│       └── remove-command.js    # Removes a community capability
│
├── platform/                    # Electron main-process bindings
│   ├── main.js                  # App bootstrap: creates windows, registers global shortcuts, tray
│   ├── ui-pipeline.js           # Routes structured payloads from skills to the correct renderer window
│   ├── model-server.js          # Manages the Vosk model server lifecycle (WASM audio processor)
│   ├── capability-installer.js  # Downloads, validates, and installs community capabilities from GitHub
│   ├── tray.js                  # System tray icon and context menu
│   ├── ipc/                     # IPC channel handlers (main-process side)
│   │   ├── query-handlers.js    # Handles text queries from main window → LLM → response
│   │   ├── voice-handlers.js    # Handles voice queries from voice window → LLM → TTS response
│   │   ├── action-handlers.js   # Handles direct skill invocations and plan execution
│   │   └── system-handlers.js   # Handles settings read/write, app controls, capability management
│   ├── preload/                 # Context-bridged preload scripts per window
│   │   ├── main.preload.js      # APIs exposed to main.window.html
│   │   ├── voice.preload.js     # APIs exposed to voice.window.html
│   │   ├── settings.preload.js  # APIs exposed to settings.window.html
│   │   └── background.preload.js# APIs exposed to background.window.html
│   ├── speech/                  # Audio I/O
│   │   ├── stt.js               # Speech-to-text: ElevenLabs Scribe (cloud) + Vosk (local fallback)
│   │   ├── tts.js               # Text-to-speech: ElevenLabs Flash v2.5 streaming synthesis
│   │   └── wake-word.js         # Offline wake-word detection using Vosk model (vosk-model-small-en-us)
│   └── windows/                 # BrowserWindow factory functions
│       ├── main-window.js       # Primary chat / query interface
│       ├── voice-window.js      # Floating voice overlay (always-on-top)
│       ├── settings-window.js   # Settings and capability management panel
│       ├── setup-window.js      # First-run onboarding / API key configuration
│       └── background-window.js # Hidden renderer for Vosk audio processing (WASM)
│
├── lib/                         # Stateless utility libraries
│   ├── logger.js                # Structured stream logger with log levels and file output
│   ├── paths.js                 # OS-aware path resolution (userData, capabilities dir, logs)
│   ├── event-bus.js             # Internal pub/sub event bus for cross-module communication
│   ├── key-pool.js              # API key rotation pool; cycles keys on rate-limit (429) errors
│   ├── key-store.js             # Secure on-disk storage for API keys
│   └── powershell.js            # Sandboxed PowerShell execution wrapper
│
└── renderer/                    # Renderer process files (HTML/JS — no Node access)
    ├── main.window.html         # Primary chat interface
    ├── voice.window.html        # Voice overlay UI
    ├── settings.window.html     # Settings / capability browser panel
    ├── setup.window.html        # First-run setup wizard
    ├── background.window.html   # Hidden Vosk audio processing host
    ├── vosk-audio-processor.js  # AudioWorkletProcessor feeding audio to Vosk WASM
    ├── lib/
    │   └── vosk.js              # Vosk WASM JavaScript wrapper
    └── workers/
        └── audio.processor.js   # Web Worker for off-thread audio decoding
```

---

## Speech Architecture

Venesa operates a three-stage audio pipeline:

```text
Microphone → AudioWorklet (vosk-audio-processor) → Vosk WASM (background renderer)
                                                           │
                                         ┌─────────────────┴──────────────────┐
                                         ▼ Wake word detected                  ▼ Local STT
                                    wake-word.js                           stt.js (local)
                                         │
                                         ▼ Trigger full query
                                    ElevenLabs Scribe (cloud STT)
                                         │
                                         ▼
                                    LLM Pipeline → tts.js (ElevenLabs Flash v2.5)
```

- **Wake-Word Detection:** Runs continuously in the hidden background window using a small Vosk model (`vosk-model-small-en-us-0.15`). CPU usage is negligible. Wake phrase is user-configurable.
- **STT:** After wake-word trigger, audio is captured and sent to ElevenLabs Scribe for cloud transcription. Local Vosk transcription is used as a fallback or for privacy mode.
- **TTS:** ElevenLabs Flash v2.5 synthesizes the `[speak]` text. Audio is streamed directly to the OS audio device. Voice, stability, and similarity settings are user-configurable.

---

## Key Management & API Rotation

`lib/key-pool.js` implements round-robin key rotation across all configured API keys. Keys are declared via environment variables with numeric suffixes (`GEMINI_API_KEY`, `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, ...). On receipt of a 429 (rate-limit) response, the pool automatically advances to the next available key without surfacing an error to the user.

`lib/key-store.js` persists keys entered through the setup wizard to disk using the Electron `safeStorage` API for encryption at rest.

---

## IPC Architecture

All communication between renderer processes and the main Node.js process goes through typed IPC channels. Renderers have **no Node.js access** — the preload scripts expose a minimal, explicitly-allowed API surface via `contextBridge`.

| Handler File | Channel Direction | Responsibility |
|---|---|---|
| `query-handlers.js` | renderer → main → renderer | Text query lifecycle, streaming chunks back to UI |
| `voice-handlers.js` | renderer → main → renderer | Voice query lifecycle, TTS audio playback coordination |
| `action-handlers.js` | renderer → main | Direct skill invocations, plan status events |
| `system-handlers.js` | renderer ↔ main | Settings CRUD, capability install/remove/toggle, app controls |

---

## Memory System

`brain/memory.js` provides a named-bucket key-value store, persisted to `~/.venesa/memory.json`.

| Bucket | Content |
|---|---|
| `preferences` | User preferences (name, language, behavior flags) |
| `history` | Rolling conversation log (last N exchanges) |
| `aliases` | Custom command aliases and capability enable/disable state |
| `reminders` | Scheduled reminder entries |

The memory system is injected into every LLM context payload, giving the model persistent awareness across sessions without stateful server infrastructure.

---

## Capability Lifecycle

```text
loader.js scans core/ + ~/.venesa/capabilities/
        │
        ▼
validator.js enforces protocol schema (name, description, returnType, schema, handler)
        │
        ▼
registry.js stores capability in memory map, fires onLoad lifecycle hook
        │
        ▼
system-prompt.js pulls registry.getMetadataForPrompt() → injected into LLM context
        │
        ▼
LLM invokes [action: capabilityName, ...params]
        │
        ▼
processor.js dispatches → registry.execute(name, params)
        │
        ▼
validator.js runs Zod parse on params → handler(validatedParams)
```

Community capabilities installed via `capability-installer.js` go through identical validation. Origin (core vs community) has no effect on runtime behaviour.

---

## Window Architecture

| Window | Role | Always-on-Top | Node Integration |
|---|---|---|---|
| `main-window` | Primary chat interface | No | No (preload only) |
| `voice-window` | Floating voice overlay | Yes | No (preload only) |
| `settings-window` | Settings and capability browser | No | No (preload only) |
| `setup-window` | First-run onboarding | No | No (preload only) |
| `background-window` | Vosk audio processing host (hidden) | — | No (preload only) |

---

## System Contracts

- **AI is the Decision-Maker:** Skill handlers are strictly passive implementations. The model controls validation routing, parameter assignment, and step ordering.
- **Unified Formatting:** Human-readable string formatting is never done by individual components. The AI owns all output copy.
- **Dynamic Capability Injection:** System prompts are assembled at query time by interpolating `registry.getMetadataForPrompt()` so the model always has an accurate capability list.
- **Render Directives:** Rich content is declared by the model via `[ui]` blocks — the renderer receives markdown payloads, not DOM instructions.
- **Silent Operations:** Background automation runs without user interruption when the model determines confirmation is redundant.
- **Sandboxed Extensibility:** A crashing or malformed community capability cannot take down core orchestration. The registry isolates each handler in a try-catch boundary.
- **No Hidden Defaults:** All behaviour is driven by settings and skill metadata. Nothing is hard-coded in the orchestration layer.
