# Venesa Architecture

## System Overview

Venesa is an Electron-based voice and text assistant with a multi-process architecture optimized for Windows. The system uses offline wake-word detection, cloud-based speech services, intelligent task orchestration, and local system integration through a modular task registry.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Window Manager (4 windows)                                 │ │
│  │  - Main (search bar)                                        │ │
│  │  - Voice (full-screen overlay)                              │ │
│  │  - Setup (first-run)                                        │ │
│  │  - Background (hidden, wake-word)                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Core Services                                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │ Wake-Word    │  │ STT Service  │  │ LLM Service  │      │ │
│  │  │ (Vosk)       │  │ (ElevenLabs) │  │ (Gemini)     │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │ TTS Service  │  │ API Key Pool │  │ User Profile │      │ │
│  │  │ (ElevenLabs) │  │ (Rotation)   │  │ (Adaptive)   │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Task Execution Layer                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │ Task         │  │ Task         │  │ Task         │      │ │
│  │  │ Registry     │──│ Orchestrator │──│ Service      │      │ │
│  │  │ (24 tasks)   │  │ (plans)      │  │ (handlers)   │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  │  ┌──────────────┐                                           │ │
│  │  │ PowerShell   │                                           │ │
│  │  │ Session      │                                           │ │
│  │  └──────────────┘                                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  IPC Handlers                                               │ │
│  │  - send-to-gemini   - voice-query                          │ │
│  │  - wake-word-detected  - execute-task                      │ │
│  │  - stt-feed         - load-models                          │ │
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
│  │ - Google View  │  │   subtitles    │  │ - Vosk Feed    │      │
│  │ - Settings     │  │ - Results      │  │ (hidden)       │      │
│  │ - AI View      │  │                │  │                │      │
│  └────────────────┘  └────────────────┘  └────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
                            │
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

## Task Execution Pipeline

```
User Input (Voice or Text)
        │
        ▼
   LLM (Gemini)
   System prompt teaches both [action:] and [plan] formats
        │
        ▼
  processResponse()
   Detects response format
        │
   ┌────┴─────┐
   │          │
[plan]     [action:]          Backward compatible
   │          │
   ▼          ▼
Orchestrator  Direct Task
              Registry Execution
   │
   ▼
Sequential Step Execution
   - Resolve $param references between steps
   - Apply execution markers (silently/announce/ask/confirm)
   - Skip steps on dependency failure
   - Registry.execute() per step
   │
   ▼
Response Assembly
   - Aggregate feedback per marker
   - Determine response mode (spoken/silent/ui)
   - Return clean response + results
```

### Execution Markers

Each step in an orchestrated plan has a marker controlling user feedback:

| Marker | Behavior |
|--------|----------|
| `silently` | Execute without user notification |
| `announce` | Inform the user before/after execution |
| `ask` | Request clarification before proceeding |
| `confirm` | Require explicit user confirmation |

### Parameter Resolution

Steps can reference results from previous steps using `$` prefixed action names:

```
[step: getClipboard, marker: silently]
[step: googleSearch, marker: announce, query: $getClipboard]
```

The orchestrator resolves `$getClipboard` to the clipboard content at runtime.

## Data Flow

### 1. Wake-Word Detection Flow

```
User speaks "Venesa"
    ↓
[Background Window] Captures audio via Web Audio API
    ↓
[Wake-Word Service] Vosk model processes audio stream (16kHz)
    ↓
[Keyword Matching] Matches variations (venessa, vanessa, venice, vanesa)
    ↓
[Main Process] IPC: wake-word-detected
    ↓
[Window Manager] Captures screen, pauses detection, shows voice window
```

### 2. Voice Query Flow

```
Voice window opens
    ↓
[Audio Worklet] Captures microphone input
    ↓
[STT Service] Voice Activity Detection (RMS > threshold)
    ↓
[VAD] Detects speech start → Records audio
    ↓
[VAD] Detects silence (1.2s) → Stops recording
    ↓
[ElevenLabs Scribe] Transcribes audio → Text
    ↓
[LLM Service] Processes with Gemini + system prompt
    ↓
[processResponse] Parses [action:] tags or [plan] blocks
    ↓
[Orchestrator / Registry] Executes tasks sequentially
    ↓
[TTS Service] Synthesizes clean response
    ↓
[Voice Window] Plays audio with karaoke subtitles
```

### 3. Text Query Flow

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
[processResponse] Parses response for actions/plans
    ↓
[Task Execution] Results returned to UI
```

## Component Details

### Task Registry

**File:** `src/core/task-registry.js`

Central module registry for all task capabilities. Each task is registered with metadata enabling the orchestrator to discover and compose them.

**Registered Tasks (24):**

| Category | Tasks |
|----------|-------|
| Apps | launchApplication, closeApp, closeAllApps, listRunningApps |
| Files | searchFiles, openFile |
| Web | openUrl, googleSearch, youtubeSearch |
| System | systemControl, getSystemInfo, getTime |
| Info | getNetworkInfo, getDiskInfo, getInstalledApps |
| Clipboard | getClipboard, setClipboard |
| Utilities | calculate, takeScreenshot, setReminder, listProcesses |
| Advanced | runPowerShell, getWeather, listen |

**Registration API:**

```javascript
registry.register('taskName', handlerFunction, {
  description: 'What this task does',
  params: ['param1', 'param2'],
  tags: ['category'],
  marker: 'announce',
  safe: true,
});
```

### Task Orchestrator

**File:** `src/core/task-orchestrator.js`

Parses LLM-generated `[plan]...[/plan]` blocks into executable step sequences. Handles parameter dependency resolution, execution marker enforcement, and response mode determination.

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `parseOrchestrationPlan()` | Extracts steps from `[plan]` blocks with input validation |
| `executePlan()` | Runs steps sequentially with dependency and marker handling |
| `resolveParams()` | Resolves `$actionName` references to previous step outputs |
| `determineResponseMode()` | Decides spoken/silent/UI feedback mode |
| `buildFeedback()` | Aggregates user-facing feedback from results |

**Duplicate Protection:** When multiple steps use the same action name, only the first result is stored under the action name key. Subsequent duplicates are accessible via `step_N` indexing.

### Task Service

**File:** `src/core/task-service.js`

Contains all task handler implementations and registers them with the task registry at startup. Processes LLM responses by detecting both `[action:]` tags and `[plan]` blocks.

**Capabilities:**

- File/folder search (recursive, 2-level depth)
- Application launch (Start Menu + fallback exec)
- System controls via PowerShell
- URL opening (security validated)
- Safe math evaluation (recursive-descent parser, no eval/Function)
- Web search (Google, YouTube)
- System info retrieval (CPU, RAM, battery, disk, network)
- Screenshot capture
- Clipboard operations (privacy-safe logging)
- Timed reminders via Electron notifications

### Wake-Word Service

**File:** `src/core/wake-word-service.js`

**Technology:** Vosk speech recognition (local, offline)

**Configuration:**

- Model: vosk-model-small-en-us-0.15 (~50MB)
- Sample rate: 16kHz
- Chunk size: 8000 bytes (0.5s)
- Confidence: 0.75
- Debounce: 2000ms

### STT Service

**File:** `src/core/stt-service.js`

**Technology:** ElevenLabs Scribe

**Voice Activity Detection (VAD):**

- RMS threshold: 0.01
- Silence duration: 1200ms
- Min speech duration: 300ms
- Pre-roll buffer: 5 frames

**Process:**

1. Continuously calculate RMS of audio chunks
2. Detect speech start (RMS > threshold)
3. Buffer pre-roll frames for natural start
4. Record until silence detected
5. Upload to ElevenLabs as WAV
6. Return transcribed text

### LLM Service

**File:** `src/core/llm-service.js`

**Technology:** Google Gemini 2.5 Flash Lite

**System Prompt:** Defined in `src/config/system-prompt.js` with separate prompts for voice and text modes.

**Response Formats:**

Single action:
```
[action: launchApplication, appName: Chrome]
```

Multi-step plan:
```
[plan]
[step: getClipboard, marker: silently]
[step: googleSearch, marker: announce, query: $getClipboard]
[/plan]
```

**Context Modes:**

- Voice: `[USER SPOKE VIA VOICE] query`
- Text: `[USER TYPED IN TEXT MODE] query`

### User Profile

**File:** `src/core/user-profile.js`

Adaptive user profiling that learns from interactions. The profile summary is injected into the system prompt to personalize responses.

### API Key Rotation

**File:** `src/core/apiKeyPool.js`

**Strategy:** Round-robin with runtime validation

**Features:**

- Soft-fail startup validation
- Runtime key removal on 401/403
- Automatic failover on rate limits (429)
- Separate pools for Gemini and ElevenLabs

### PowerShell Session

**File:** `src/core/powershell-session.js`

Persistent PowerShell session for system command execution. Features timeout handling, output buffering, and automatic session restart on failure.

## Configuration System

Centralized in `src/config/`:

**services.config.js:**

- LLM model selection and generation config
- TTS voice settings
- Safety settings for content filtering

**system-prompt.js:**

- Separate prompts for voice and text modes
- Action command reference with all 24 tasks
- Orchestration guide with [plan] format documentation
- Dynamic skills for creative task composition
- Personality and behavior rules

## Error Handling

**Task Orchestration:**

- Input validation on plan parser (null/non-string guard)
- Per-step try-catch in registry execution
- Dependency chain failure propagation (skip dependent steps)
- Duplicate action name detection with warnings

**Wake-Word Process:**

- Auto-restart on crash (2s delay)
- Health checks via stdout/stderr
- Process exit monitoring

**API Calls:**

- Try up to 3 keys on failure
- Report errors to key pool
- Remove invalid keys
- Return user-friendly messages

**Microphone Access:**

- Retry with exponential backoff
- Coordinate release between windows
- Timeout fallback (3s)

**IPC Communication:**

- Try-catch wrappers on all handlers
- Sender destruction checks before response
- Timeout handlers

## Security

**PowerShell Commands:**

- Strict allowlist (`SAFE_PS_PATTERNS`): Commands must match verified regex patterns
- Blocked patterns (`DANGEROUS_PS_PATTERNS`): Explicitly blocks obfuscation, network downloads, execution aliases, and destructive commands
- Secret protection: System prompts instruct the LLM to never output secrets in plaintext
- Input sanitization: Dynamic arguments sanitized to prevent command injection

**Math Evaluation:**

- Safe recursive-descent parser (no `eval` or `Function` constructor)
- Input sanitized to numeric and operator characters only
- Proper parenthesis validation

**File Access:**

- Restricted to home directory
- Path normalization and validation
- Single-quote escaping in PowerShell-embedded paths
- No arbitrary path traversal

**Network:**

- URL scheme whitelist (http/https only)
- API key environment variables (never in code)
- No credentials in logs

**Clipboard:**

- Privacy-safe logging (content truncated/masked)
- Type validation before write operations

**IPC:**

- Preload script isolation
- Context bridge pattern
- No nodeIntegration in renderer

## Performance

**Wake-Word:**

- Streaming processing (no full-file buffering)
- Lightweight Vosk model (50MB)
- Subprocess isolation (no main thread blocking)

**Audio Processing:**

- AudioWorklet for low latency
- Efficient buffer management
- VAD to reduce API calls

**UI:**

- Google webview pre-loading
- Screen capture caching
- Minimal re-renders

**API:**

- Key rotation reduces rate limit impact
- Parallel validation at startup
- Cached model instances

## Scaling Guidelines

**Adding New Tasks:**

1. Implement the handler function in `src/core/task-service.js`
2. Register it with the task registry in `registerAllTasks()`
3. Add documentation to the system prompt in `src/config/system-prompt.js`
4. The orchestrator will automatically support it in multi-step plans

**Adding New Services:**

1. Create service module in `src/core/`
2. Add logger integration
3. Export clean API
4. Register IPC handlers in `src/main/main.js`

**Adding Configuration:**

1. Add to `src/config/services.config.js` or create new config file
2. Import in relevant services
3. Document in README

**Modifying System Prompt:**

1. Edit `src/config/system-prompt.js`
2. Keep concise (token cost impacts latency)
3. Test action tag and plan parsing
4. Validate with both voice and text queries

---

Built for reliability, performance, and maintainability.
