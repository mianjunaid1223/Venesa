# Architecture Manual

## Overview

Venesa is a **generic execution platform** for Windows built on Electron. The language model is the strategic reasoning layer - it plans. The platform is the execution layer - it validates and runs. No component formats or re-interprets the model's output independently.

**Version:** 2.0.0
**Governance:** Venesa Governance & Execution Contract v2.1
**Target Platform:** Windows 10 / 11 (x64)
**Runtime:** Electron 28, Node.js ≥ 18.17.0
**Primary Model:** Google Gemini 2.5
**Speech Stack:** Vosk (offline wake-word) + ElevenLabs Scribe (cloud STT) + ElevenLabs Flash v2.5 (TTS)
**Validation:** Zod v4
**Packaging:** electron-builder (NSIS installer, x64)

## Foundational Principles

**Generic Over Specific** - No capability names hardcoded into prompts. No workflow assumptions baked in. All behaviors follow a universal pattern.

**Strict Yet Flexible** - Strict contracts. Strict schema validation. Strict execution pipeline. Flexible interpretation of user intent within those constraints.

**Divide and Conquer** - Every complex task is decomposed into small deterministic steps. Each step is independently executable. The LLM plans. The runtime executes.

**UI as Intent, Not Decoration** - UI is optional. UI is only rendered when the output is structurally complex, requires user interaction, or visual layout meaningfully improves comprehension.

## Universal Workflow Pipeline

Every operation in Venesa traverses all 7 stages in order. No stage may mutate another's responsibility. Some stages are **mandatory** (always execute); others are **conditional** (execute as a no-op when not applicable).

- **Mandatory stages:** `INTENT_PARSING`, `FEASIBILITY_EVALUATION`, `PLAN_CONSTRUCTION`, `RESULT_STRUCTURING`.
- **Conditional stages (may be no-ops):** `STEP_EXECUTION` (no-op for `RETURN_DATA`/`REFUSE` decisions), `UI_RENDERING` (no-op when no UI output is warranted), `MEMORY_UPDATE` (no-op when no context warrants persistence).
- **Edge-case examples:**
  - *Failed FEASIBILITY* - `PLAN_CONSTRUCTION`, `STEP_EXECUTION`, and `UI_RENDERING` become no-ops; pipeline emits a structured refusal.
  - *Informational query (RETURN_DATA)* - `STEP_EXECUTION` is a no-op; data is returned directly.
  - *Refused request (REFUSE)* - `STEP_EXECUTION`, `UI_RENDERING`, and `MEMORY_UPDATE` are no-ops; pipeline emits a refusal and terminates.

> **Invariant:** Conditional stages that run as no-ops still pass through the pipeline; they simply perform no work and produce no output.

```text
1. INTENT PARSING      - Determine what the user actually needs.
2. FEASIBILITY         - Evaluate whether the request is safe, defined, and executable.
3. PLAN CONSTRUCTION   - Decompose into atomic steps.
4. STEP EXECUTION      - Runtime validates and executes structured instructions.
5. RESULT STRUCTURING  - Organize outputs for response.
6. UI RENDERING        - Render UI only if structurally justified.
7. MEMORY UPDATE       - Persist context if warranted (explicit mutation only).
```

## Execution Flow

```text
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌───────────────┐
│  User Input  │───▶│ Context / Memory │───▶│  LLM Engine  │───▶│ Protocol Parser │───▶│ Skill Executor│
│ (text/voice) │    │   Resolution     │    │ (Selected model) │    │ (processor.js)  │    │(orchestrator) │
└──────────────┘    └──────────────────┘    └──────────────┘    └─────────────────┘    └───────────────┘
                                                                                                │
                                                                         ┌──────────────────────┤
                                                                         ▼                      ▼
                                                                  ┌────────────┐       ┌──────────────┐
                                                                  │ TTS Engine │       │  UI Pipeline │
                                                                  │(ElevenLabs)│       │  (renderer)  │
                                                                  └────────────┘       └──────────────┘
```

## AI Authority Contract

The LLM is the strategic reasoning layer. It must:

- Break large tasks into atomic operations.
- Evaluate risk before execution.
- Decide one of: `EXECUTE` | `REQUEST_CONFIRMATION` | `REFUSE` | `RETURN_DATA` | `RETURN_UI`

The AI may independently refuse:

- Unsafe tasks
- Ill-defined tasks
- Technically infeasible tasks
- Tasks requiring unavailable resources

**Refusal is structured, not conversational.** Format: `"Cannot [action]: [single-sentence reason]."`

The AI must never directly manipulate system state. It only emits structured instructions.

## Execution Contract

All LLM output conforms to bracket-syntax execution instructions:

```text
SINGLE ACTION:
[action: toolName, param: value]

MULTI-STEP PLAN:
[plan]
[step: toolName, marker: silently|announce|confirm, param: value, label: Natural description]
[step: toolName2, marker: announce, param: $step1.field, label: Natural description]
[/plan]
```

**Execution modes** (classified by `processor.js`):

- `execute` - action steps with system side-effects
- `data` - information retrieval, no side-effects
- `ui` - visual output without execution
- `refuse` - structured refusal

**Execution markers:**

- `silently` - background execution, no narration
- `announce` - narrate the action as it executes
- `confirm` - pause execution until user explicitly approves

### AI Decision → Execution Mode Mapping

The LLM emits one of five AI decisions. `processor.js` maps each to an execution mode and a default marker:

| AI Decision | Execution Mode | Default Marker | Notes |
|---|---|---|---|
| `EXECUTE` | `execute` | `silently` or `announce` | Standard action with system side-effects. |
| `REQUEST_CONFIRMATION` | `execute` | `confirm` | Execution is paused until the user explicitly approves. The `confirm` marker is the runtime implementation of `REQUEST_CONFIRMATION`. |
| `REFUSE` | `refuse` | - | No execution. Structured refusal emitted. |
| `RETURN_DATA` | `data` | - | Information retrieval; no side-effects. |
| `RETURN_UI` | `ui` | - | Visual output rendered via UI pipeline; no execution. |

> **Key interaction:** `REQUEST_CONFIRMATION` maps to `execute` mode with the `confirm` marker. The `confirm` marker in `processor.js` is what pauses pipeline execution and surfaces an approval prompt. Locate `confirm` handling in `processor.js` to understand how `REQUEST_CONFIRMATION` is enforced at runtime.

## UI Contract

UI is optional and only rendered when:
a) The output is structurally complex
b) The user requires interaction with the result
c) Visual layout meaningfully improves comprehension

```text
[ui]
## Title
| Column A | Column B |
|----------|----------|
| value    | value    |
[/ui]

[ui: table | key-value | card-list | command-list]
```

UI must be declarative. No hardcoded capability logic. No Node access from UI. Communication strictly through validated IPC.

## Memory Contract

All memory mutations are explicit. No implicit writes.

Mutation contract: `{ bucket, operation: 'set'|'append'|'remove', key, value }`

API: `memory.mutate({ bucket, operation, key, value })`

Buckets: `preferences` | `context` | `aliases` | `history`

## Core Module Structure

```text
src/
├── brain/                       # Intelligence core
│   ├── protocol.js              # Single source of truth: all protocol constants v2.1
│   │                            #   RETURN_TYPES, EXECUTION_MARKERS, EXECUTION_MODES,
│   │                            #   AI_DECISIONS, MEMORY_OPERATIONS,
│   │                            #   WORKFLOW_STAGES, LIFECYCLE_HOOKS
│   ├── llm.js                   # Gemini API client; key rotation, prompt caching (TTL 60s),
│   │                            #   session management, image data parsing, retry with key failover
│   ├── processor.js             # Protocol parser: extracts [speak], [silent], [ui], [action:], [plan]
│   │                            #   Classifies execution mode and engaged pipeline stages
│   ├── orchestrator.js          # Plan executor: lexes steps, resolves $variables, serial execution
│   │                            #   resolveStepRefs: null-output detection - throws clear error when a
│   │                            #   referenced step failed, distinct from a genuinely missing field
│   ├── system-prompt.js         # Builds LLM context from memory + skill registry
│   │                            #   Identity, personality, protocol, orchestration guide,
│   │                            #   token system, internal tools, refusal rules
│   ├── memory.js                # Named-bucket key-value store persisted to disk (~/.venesa/memory/)
│   │                            #   mutate(): explicit mutation contract API
│   ├── services.config.js       # Third-party service configuration (ElevenLabs, Gemini)
│   └── settings.js              # User preference schema and defaults (~/.venesa/settings.json)
│
├── skills/                      # Capability execution environment
│   ├── registry.js              # In-memory skill map; builds prompt metadata; enable/disable state
│   ├── loader.js                # Auto-discovers core/ + internal/ + ~/.venesa/capabilities/
│   │                            #   Fires lifecycle hooks; Module._resolveFilename patched so
│   │                            #   community capabilities resolve deps from their local node_modules
│   │                            #   first, then fall back to app-wide node_modules
│   ├── validator.js             # Validates capability shape against protocol; enforces Zod schemas
│   ├── core/                    # Built-in capabilities (always loaded)
│   │   ├── _shared.js           # Shared helper utilities for core skills
│   │   ├── clipboard.js         # Clipboard read/write
│   │   ├── clipboard-history.js # Clipboard history tracking
│   │   ├── close-all-apps.js    # Close all running applications
│   │   ├── close-app.js         # Close a specific application
│   │   ├── file-ops.js          # File system operations (read, write, move, copy, delete)
│   │   ├── google-search.js     # Web search via Google
│   │   ├── launch-app.js        # Launch an application
│   │   ├── open-file.js         # Open a file with its default program
│   │   ├── open-url.js          # Open a URL in the default browser
│   │   ├── run-powershell.js    # Execute PowerShell commands
│   │   ├── search-files.js      # Search for files by name/pattern
│   │   ├── set-reminder.js      # Create timed reminders
│   │   ├── system-control.js    # System operations (volume, brightness, lock, etc.)
│   │   ├── take-screenshot.js   # Capture screen
│   │   └── window-manager.js    # Window manipulation (move, resize, minimize, etc.)
│   └── internal/                # Internal meta-skills (not injected into system prompt)
│       ├── get-chat-history.js  # Retrieve conversation history
│       ├── get-memory.js        # Read from memory buckets
│       ├── list-commands.js     # List available commands
│       ├── listen.js            # Trigger listening mode
│       ├── manage-commands.js   # Enable/disable capabilities
│       ├── remove-command.js    # Remove a community capability
│       └── set-memory.js        # Write to memory buckets
│
├── platform/                    # Electron main-process bindings
│   ├── main.js                  # App bootstrap: windows, global shortcuts, tray, protocol
│   │                            #   Single-instance lock (requestSingleInstanceLock)
│   │                            #   venesa-asset:// custom protocol for asset loading
│   │                            #   Alt+Space global shortcut; auto-login settings
│   │                            #   Validates venesa.standard.json on startup
│   ├── ui-pipeline.js           # Routes structured payloads from skills to the correct renderer
│   ├── model-server.js          # Vosk model HTTP server lifecycle (pre-warmed at startup)
│   ├── capability-installer.js  # Downloads, validates, installs community capabilities
│   ├── dep-manager.js           # Dependency engine for community capabilities
│   │                            #   Transitive npm package resolution via pacote (no external npm CLI)
│   │                            #   Per-capability isolated node_modules under ~/.venesa/capabilities/
│   │                            #   Failure tracking (dep-failures.json) with MAX_FAILURES threshold
│   │                            #   Pinned versions: floating specs resolve once and pin
│   ├── tray.js                  # System tray icon and context menu
│   ├── ipc/                     # IPC channel handlers (main-process side)
│   │   ├── query-handlers.js    # Text query lifecycle, streaming chunks to UI
│   │   ├── voice-handlers.js    # Voice query lifecycle + TTS coordination
│   │   ├── action-handlers.js   # Direct skill invocations and plan execution
│   │   └── system-handlers.js   # Settings CRUD, capability management, app controls
│   │                            #   Wake-word deduplication: wakeWordActive flag prevents double-start
│   │                            #   across applyWakeWordPatch and setup-flow startWakeWord calls
│   ├── preload/                 # Context-bridged preload scripts per window
│   │   ├── main.preload.js      # Main window preload - minimal IPC surface
│   │   ├── voice.preload.js     # Voice window preload
│   │   ├── settings.preload.js  # Settings window preload - settings CRUD + capability mgmt
│   │   ├── background.preload.js# Background window preload - Vosk model loading
│   │   └── (no Node access in renderer - contextBridge only)
│   ├── speech/                  # Audio I/O
│   │   ├── stt.js               # Speech-to-text service (ElevenLabs Scribe cloud STT)
│   │   ├── tts.js               # Text-to-speech service (ElevenLabs Flash v2.5)
│   │   └── wake-word.js         # Vosk-based offline wake-word detection
│   └── windows/                 # BrowserWindow factory functions
│       ├── main-window.js       # Main chat/query window
│       ├── voice-window.js      # Voice interaction overlay
│       ├── settings-window.js   # Settings panel
│       ├── setup-window.js      # First-run onboarding / setup wizard
│       └── background-window.js # Hidden window for Vosk WASM model loading
│
├── lib/                         # Stateless utility libraries
│   ├── logger.js                # Structured logger with levels and file output
│   ├── paths.js                 # OS-aware path resolution
│   │                            #   Dev vs packaged path branching (process.resourcesPath)
│   │                            #   getEnvPath: ~/.venesa/.env in production (user-writable),
│   │                            #     project root .env in development
│   │                            #   getVenesaDir, getSettingsPath, getMemoryPath, getCapabilitiesPath
│   ├── event-bus.js             # Internal pub/sub event bus
│   ├── key-pool.js              # API key rotation pool with error reporting and failover
│   ├── key-store.js             # Secure on-disk key storage (electron safeStorage)
│   ├── token-resolver.js        # {{token}} resolution: resolveToken, resolveString, resolvePath
│   │                            #   Platform-aware folder paths (Electron → Windows registry → XDG dirs)
│   │                            #   Tilde expansion: ~/... resolved to home before path.normalize
│   │                            #   Node.js 18+ safe: network.ip accepts numeric family (4) and string ("IPv4")
│   ├── powershell.js            # Persistent PowerShell session - single process, command queue, auto-restart
│   ├── connectivity.js          # Network reachability monitor - polls via Electron net API every 5s
│   │                            #   HEAD probe to google.com; onChange listeners for online/offline transitions
│   └── env.js                   # Safe environment variable accessor (getEnv)
│                                #   Capabilities must use getEnv - direct process.env enumeration disallowed
│
└── renderer/                    # Renderer process files (HTML/JS - no Node access)
    ├── main.window.html         # Main chat/query UI
    ├── voice.window.html        # Voice interaction UI
    ├── settings.window.html     # Settings panel UI
    ├── setup.window.html        # First-run setup/onboarding UI
    ├── background.window.html   # Hidden Vosk WASM loader
    ├── vosk-audio-processor.js  # AudioWorklet processor for microphone stream
    ├── lib/
    │   └── vosk.js              # Vosk WASM library (bundled, ~5.5 MB)
    └── workers/
        └── audio.processor.js   # Audio processing worker
```

## Speech Architecture

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

## IPC Architecture

All communication between renderer processes and the main Node.js process goes through typed IPC channels. Renderers have **no Node.js access** - preload scripts expose a minimal, explicitly-allowed API surface via `contextBridge`.

| Handler File         | Responsibility                                                |
| -------------------- | ------------------------------------------------------------- |
| `query-handlers.js`  | Text query lifecycle, streaming chunks to UI                  |
| `voice-handlers.js`  | Voice query lifecycle, TTS audio playback coordination        |
| `action-handlers.js` | Direct skill invocations, plan status events                  |
| `system-handlers.js` | Settings CRUD, capability install/remove/toggle, app controls |

### Preload Scripts

Each BrowserWindow type has a dedicated preload script that exposes only the IPC channels that window needs:

| Preload File              | Window               | API Surface                                     |
| ------------------------- | -------------------- | ----------------------------------------------- |
| `main.preload.js`         | Main query window    | Text queries, resize notifications, mic trigger |
| `voice.preload.js`        | Voice overlay        | Voice capture, TTS playback, query lifecycle    |
| `settings.preload.js`     | Settings panel       | Settings CRUD, capability management, key CRUD  |
| `background.preload.js`   | Background (hidden)  | Vosk model server URL, wake-word events         |

## Capability Lifecycle

```text
loader.js scans core/ + internal/ + ~/.venesa/capabilities/
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
processor.js dispatches → registry → validator.js runs Zod parse → handler(validatedParams)
```

Community capabilities go through identical validation. Origin (core vs community) has no effect on runtime behaviour. A broken capability cannot crash the system - each handler runs in an isolated try-catch boundary.

**Community override of core skills:** A community capability with the same `name` as a built-in core skill overrides it at load time. The core skill's `onUnload` lifecycle hook is called before deregistration. This lets the community repository ship improved versions of built-ins without patching source.

### Community Dependency Isolation

Community capabilities may declare npm dependencies. The **dep-manager** (`dep-manager.js`) handles installation:

- Uses **pacote** (bundled) for transitive resolution - no external npm CLI required.
- Each capability gets its own `node_modules` directory under `~/.venesa/capabilities/<name>/node_modules/`.
- Floating version specs (e.g. `axios`) are resolved to an exact version once and **pinned** in `dependencies.json`. Reinstalls always use the pinned version.
- Failure tracking via `dep-failures.json` - after `MAX_FAILURES` (5) consecutive failures, a capability is marked **corrupted** and will not load.
- The **loader** patches `Module._resolveFilename` so that `require()` calls from within a community capability's handler check the capability's local `node_modules` first, then fall back to the app-wide `node_modules`.

#### Module._resolveFilename - Internal API Risk

`Module._resolveFilename` is a **Node.js-internal API** (not part of the public stable API surface). It can change without notice in any Node.js release. Venesa relies on it for community capability dependency isolation.

**Existing runtime mitigations (in `loader.js`):**

- **Feature-detect guard:** The patch checks `Module._resolveFilename.__venesa_cap_patched` before applying, preventing double-patching.
- **try/catch fallback:** The patched function wraps all resolution attempts in try/catch. If the patched path fails at any stage (capability-local, app-wide, or platform-source), the original `MODULE_NOT_FOUND` error is re-thrown. Default Node.js resolution is never broken - the patch only intercepts errors from the original resolver and attempts alternative lookup paths.
- **Graceful degradation:** If `Module._resolveFilename` is removed or its signature changes in a future Node.js version, the IIFE that installs the patch will throw at line `const _orig = Module._resolveFilename.bind(Module)`. This error is caught by the IIFE wrapper and logged - core and internal capabilities continue to load normally. Only community capabilities with external npm dependencies will fail to resolve their packages.

**Node version requirement:** The `engines` field in `package.json` enforces `node >= 18.17.0`. The `main.js` startup validator (`validateStandard()`) cross-checks this constraint. Node 18.17.0+ guarantees the `Module._resolveFilename` signature used by the patch.

**Recommended CI test plan:**

- Run a dedicated CI matrix job that exercises the module resolution patch (`loader.js` lines 19-104) against the **current LTS**, **current stable**, and **next RC** Node.js versions.
- The test should: (1) load a mock community capability with an npm dependency, (2) verify `require()` resolves from the capability-local `node_modules`, (3) verify fallback to app-wide `node_modules` when local resolution fails, (4) verify that if `Module._resolveFilename` is missing or has an unexpected signature, the patch degrades gracefully and core skills still load.
- Flag any CI failure as a blocking issue before upgrading the minimum Node version.

## Environment & Path Resolution

```text
Development:
  .env             → project root (.env)
  settings.json    → ~/.venesa/settings.json
  memory/          → ~/.venesa/memory/
  capabilities/    → ~/.venesa/capabilities/
  logs/            → project root (logs/)
  models/          → project root (models/)
  assets/          → project root (assets/)

Packaged (NSIS installer):
  .env             → ~/.venesa/.env  (copied from .env.production at build time)
  settings.json    → ~/.venesa/settings.json
  memory/          → ~/.venesa/memory/
  capabilities/    → ~/.venesa/capabilities/
  logs/            → %APPDATA%/venesa/logs  (via app.getPath('userData'))
  models/          → process.resourcesPath/models  (extraResources)
  assets/          → process.resourcesPath/assets  (extraResources)
```

The `paths.js` module abstracts this branching. All modules use `paths.getEnvPath()`, `paths.getModelsPath()`, etc. - no raw path construction.

## Assets

```text
assets/
├── icon.ico               # Application icon (Windows .ico)
├── logo.png               # Logo image (PNG)
├── activations sound.wav   # Legacy activation sound
├── cue-activation.wav     # Audio cue: wake-word activated
├── cue-closing.wav        # Audio cue: session closing
├── cue-done.wav           # Audio cue: task completed
├── cue-listening.wav      # Audio cue: listening started
└── no-internet.mp3        # Audio cue: no internet connectivity
```

## Build & Packaging

Packaging is handled by **electron-builder** (`electron-builder.json`):

- **Installer:** NSIS (non-one-click, user-selectable install directory)
- **Target:** Windows x64 only
- **Output:** `dist2/`
- **ASAR:** Enabled; `vosk-browser` unpacked (native WASM binaries)
- **Extra resources:** `assets/`, `models/`, `.env.production` → `.env`
- **Excluded from ASAR:** `.env.production` (bundled as extra resource instead)

## Standards Enforcement

`venesa.standard.json` is the machine-readable coding standard. It is validated at startup by `main.js → validateStandard()`. The standard defines:

- **Naming conventions:** camelCase identifiers, kebab-case filenames, UPPER_SNAKE_CASE constants
- **Token syntax:** `{{token_name}}` with error policy on unknown tokens
- **Capability schema:** required/optional fields, return types, dependency formats
- **Validation gates:** startup, plan structure, step structure, token resolution, capability responses, UI schema

## System Contracts

- **AI is the Planner:** The runtime executes. Skill handlers are strictly passive implementations. The model controls parameter assignment, step ordering, and execution decisions.
- **No Hardcoded Capability Logic:** Core must not depend on any specific capability. All behaviors derive from skill metadata and protocol constants.
- **Capability-Agnostic Core:** Capabilities are plugins adhering to a strict schema. Broken capabilities cannot break the system.
- **Deterministic Interfaces:** Stable contracts. Versioned protocol. Strict validation before execution.
- **Explicit Memory Writes:** All memory mutations go through `memory.mutate()`. No implicit writes.
- **Sandboxed Extensibility:** Community capabilities run in isolated dependency space. UI sandboxed. Execution guarded.
- **No Hidden Defaults:** All behaviour is driven by settings and skill metadata. Nothing hardcoded in the orchestration layer.
- **Environment Isolation:** Capabilities access environment variables only via `getEnv()` - direct `process.env` enumeration is disallowed.
- **Network Awareness:** The `connectivity` module monitors reachability. Modules can subscribe to online/offline transitions to degrade gracefully.
