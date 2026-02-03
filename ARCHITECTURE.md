# Venesa Architecture

## System Overview

Venesa is an Electron-based voice assistant with a multi-process architecture optimized for Windows. The system uses offline wake-word detection, cloud-based speech services, and local system integration.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     MAIN PROCESS                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Window Manager (4 windows)                            │ │
│  │  - Main (search bar)                                   │ │
│  │  - Voice (full-screen overlay)                         │ │
│  │  - Setup (first-run)                                   │ │
│  │  - Background (hidden, wake-word)                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Core Services                                         │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │ │
│  │  │ Wake-Word    │  │ STT Service  │  │ LLM Service  │ │ │
│  │  │ (Vosk/Python)│  │ (ElevenLabs) │  │ (Gemini)     │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │ │
│  │  │ TTS Service  │  │ Task Service │  │ API Key Pool │ │ │
│  │  │ (ElevenLabs) │  │ (System)     │  │ (Rotation)   │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  IPC Handlers                                          │ │
│  │  - voice-query     - wake-word-detected               │ │
│  │  - ai-query        - execute-task                     │ │
│  │  - stt-feed        - load-models                      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ IPC Communication
                            │
┌─────────────────────────────────────────────────────────────┐
│                   RENDERER PROCESSES                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ Main Window    │  │ Voice Window   │  │ Background     │ │
│  │                │  │                │  │ Window         │ │
│  │ - Search UI    │  │ - Karaoke      │  │ - Audio Capture│ │
│  │ - Google View  │  │   subtitles    │  │ - Vosk Feed    │ │
│  │ - Settings     │  │ - Results      │  │ (hidden)       │ │
│  │ - AI VIEW      │  │                │  │                │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   EXTERNAL SERVICES                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ Vosk Model     │  │ ElevenLabs API │  │ Google Gemini  │ │
│  │ (Local/Python) │  │ (Cloud)        │  │ (Cloud)        │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Wake-Word Detection Flow

```
User speaks "Venesa"
    ↓
[Background Window] Captures audio via Web Audio API
    ↓
[Wake-Word Service] Spawns Python subprocess
    ↓
[Vosk Model] Processes audio stream (16kHz, 8000-byte chunks)
    ↓
[Python Script] Keyword matching (venessa, vanessa, venice, vanesa)
    ↓
[JSON Output] {"detected": true, "text": "venessa"}
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
[LLM Service] Processes with Gemini + context
    ↓
[Action Parser] Extracts [action: ...] tags
    ↓
[Task Service] Executes system actions
    ↓
[TTS Service] Synthesizes response
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
    - None → Search files/apps
    - / → AI query
    - // → Google search
    ↓
[Task Service] Searches or sends to LLM
    ↓
[Main Window] Displays results
```

## Component Details

### Wake-Word Service

**Technology:** Vosk + Python subprocess

**Why subprocess?**

- Avoids Electron native module rebuild issues
- Reliable process isolation
- Automatic restart on crash
- Simple Python integration

**Implementation:**

```javascript
spawn("python", [
  "scripts/vosk-detector.py",
  "models/vosk-model-small-en-us-0.15",
  "venessa,vanessa,venice,vanesa",
]);
```

**Configuration:**

- Model: vosk-model-small-en-us-0.15 (~50MB)
- Sample rate: 16kHz
- Chunk size: 8000 bytes (0.5s)
- Confidence: 0.75
- Debounce: 2000ms

### STT Service

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

**Technology:** Google Gemini 2.5 Flash Lite

**System Prompt:** Defined in `src/config/system-prompt.js`

**Action Tags:**

- `[action: searchFiles, query: term]`
- `[action: launchApplication, appName: app]`
- `[action: systemControl, command: cmd, value: val]`
- `[action: openUrl, url: url]`
- `[action: listen]`
- `[action: getSystemInfo]`

**Context Modes:**

- Voice: `[USER SPOKE VIA VOICE] query`
- Text: `[USER TYPED IN TEXT MODE] query`

### API Key Rotation

**Strategy:** Round-robin with runtime validation

**Features:**

- Soft-fail startup validation
- Runtime key removal on 401/403
- Automatic failover on rate limits (429)
- Separate pools for Gemini and ElevenLabs
- Support for detailed quota tracking

**Implementation:**

```javascript
{
  gemini: { keys: [...], index: 0, valid: [...] },
  elevenlabs: { keys: [...], index: 0, valid: [...] }
}
```

### Task Service

**Capabilities:**

- File/folder search (recursive, 2-level depth)
- Application launch (Start Menu + fallback exec)
- System controls (PowerShell scripts)
- URL opening (security validated)
- System info (CPU, RAM, disk)

**Security:**

- **Command Allowlisting:** Only specific, pre-approved PowerShell commands are allowed.
- **Input Sanitization:** user inputs are escaped before being interpolated into commands.
- **Path Traversal Protection:** File access is restricted to safe directories.
- **URL Scheme Whitelist:** Only `http` and `https` schemes are permitted.
- **Safe Clipboard Handling:** Clipboard operations use dedicated, escaped handlers.

### Logger

**Technology:** Winston

**Configuration:**

- Development: DEBUG level
- Production: INFO level
- File rotation: 5MB max, 5 files
- Transport: Console + Files

**Output:**

- `error.log` - Errors only
- `combined.log` - All logs

## Configuration System

Centralized in `src/config/`:

**wake-word.config.js:**

- Keywords array
- Confidence threshold
- Debounce timing
- Model path

**audio.config.js:**

- Sample rate
- Channels
- VAD thresholds
- Silence/speech durations

**services.config.js:**

- LLM model selection
- TTS voice settings
- STT configuration

**ui.config.js:**

- Window dimensions
- Animation timings
- Background colors

**system-prompt.js:**

- AI behavior rules
- Action command reference
- Voice vs text mode handling
- Security guidelines for handling secrets

## Error Handling

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

- Try-catch wrappers
- Timeout handlers
- Error event logging

## Performance Optimizations

**Wake-Word:**

- Streaming processing (no full-file buffering)
- Lightweight Vosk model (50MB)
- Subprocess isolation (no main thread blocking)

**Audio Processing:**

- AudioWorklet for low latency
- Efficient buffer management
- VAD to reduce API calls

**UI:**

- Google webview pre-loading (kept per user request)
- Screen capture caching
- Minimal re-renders

**API:**

- Key rotation reduces rate limit impact
- Parallel validation at startup
- Cached model instances

## Security Considerations

**PowerShell & System Commands:**

- **Strict Allowlist (`SAFE_PS_PATTERNS`):** Commands must match verified regex patterns (e.g., `Get-CimInstance`, `Get-Process`).
- **Blocked Patterns (`DANGEROUS_PS_PATTERNS`):** Explicitly blocks obfuscation, network downloads, execution aliases (`iex`, `invoke-expression`), and destructive commands (`Remove-`, `Stop-`).
- **Secret Protection:** System prompts are instructed never to output secrets (e.g., WiFi passwords) in plaintext.
- **Sanitization:** All dynamic arguments are sanitized to prevent command injection.

**File Access:**

- Restricted to home directory
- Path normalization and validation
- No arbitrary path traversal

**Network:**

- URL scheme whitelist
- API key environment variables
- No credentials in logs

**IPC:**

- Preload script isolation
- Context bridge pattern
- No nodeIntegration in renderer

## Scaling Guidelines

**Adding New Services:**

1. Create service in `src/core/`
2. Add logger integration
3. Export clean API
4. Register in main.js

**Adding Configuration:**

1. Create config in `src/config/`
2. Export module
3. Import in relevant services
4. Document in README

**Adding IPC Handlers:**

1. Define handler in main.js
2. Add error try-catch
3. Log events
4. Expose via preload script

**Modifying System Prompt:**

1. Edit `src/config/system-prompt.js`
2. Keep concise (token cost)
3. Test action tag parsing
4. Validate with multiple queries

## Future Improvements

**Potential Enhancements:**

- Custom wake-word training
- Local LLM fallback (llama.cpp)
- Multi-language support
- Voice profile recognition
- Conversation history
- Plugin system

**Code Quality:**

- Unit tests (Jest)
- Integration tests (Playwright)
- TypeScript migration
- Performance profiling
- CI/CD pipeline

---

Built for reliability, performance, and maintainability.
