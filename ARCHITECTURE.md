# Architecture Manual

## Overview

Venesa is a **generic execution platform** for Windows built on Electron. The language model is the strategic reasoning layer — it plans. The platform is the execution layer — it validates and runs. No component formats or re-interprets the model's output independently.

**Version:** 2.0.0
**Governance:** Venesa Governance & Execution Contract v2.0
**Target Platform:** Windows 10 / 11 (x64)
**Runtime:** Electron 28, Node.js ≥ 18
**Primary Model:** Google Gemini 2.5
**Speech Stack:** Vosk (offline wake-word) + ElevenLabs Scribe (cloud STT) + ElevenLabs Flash v2.5 (TTS)

## Foundational Principles

**Generic Over Specific** — No capability names hardcoded into prompts. No workflow assumptions baked in. All behaviors follow a universal pattern.

**Strict Yet Flexible** — Strict contracts. Strict schema validation. Strict execution pipeline. Flexible interpretation of user intent within those constraints.

**Divide and Conquer** — Every complex task is decomposed into small deterministic steps. Each step is independently executable. The LLM plans. The runtime executes.

**UI as Intent, Not Decoration** — UI is optional. UI is only rendered when the output is structurally complex, requires user interaction, or visual layout meaningfully improves comprehension.

## Universal Workflow Pipeline

Every operation in Venesa traverses all 7 stages in order. No stage may mutate another's responsibility. Some stages are **mandatory** (always execute); others are **conditional** (execute as a no-op when not applicable).

- **Mandatory stages:** `INTENT_PARSING`, `FEASIBILITY_EVALUATION`, `PLAN_CONSTRUCTION`, `RESULT_STRUCTURING`.
- **Conditional stages (may be no-ops):** `STEP_EXECUTION` (no-op for `RETURN_DATA`/`REFUSE` decisions), `UI_RENDERING` (no-op when no UI output is warranted), `MEMORY_UPDATE` (no-op when no context warrants persistence).
- **Edge-case examples:**
  - *Failed FEASIBILITY* — `PLAN_CONSTRUCTION`, `STEP_EXECUTION`, and `UI_RENDERING` become no-ops; pipeline emits a structured refusal.
  - *Informational query (RETURN_DATA)* — `STEP_EXECUTION` is a no-op; data is returned directly.
  - *Refused request (REFUSE)* — `STEP_EXECUTION`, `UI_RENDERING`, and `MEMORY_UPDATE` are no-ops; pipeline emits a refusal and terminates.

> **Invariant:** Conditional stages that run as no-ops still pass through the pipeline; they simply perform no work and produce no output.

```text
1. INTENT PARSING      — Determine what the user actually needs.
2. FEASIBILITY         — Evaluate whether the request is safe, defined, and executable.
3. PLAN CONSTRUCTION   — Decompose into atomic steps.
4. STEP EXECUTION      — Runtime validates and executes structured instructions.
5. RESULT STRUCTURING  — Organize outputs for response.
6. UI RENDERING        — Render UI only if structurally justified.
7. MEMORY UPDATE       — Persist context if warranted (explicit mutation only).
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
[step: toolName2, marker: announce, param: $toolName, label: Natural description]
[/plan]
```

**Execution modes** (classified by `processor.js`):

- `execute` — action steps with system side-effects
- `data` — information retrieval, no side-effects
- `ui` — visual output without execution
- `refuse` — structured refusal

**Execution markers:**

- `silently` — background execution, no narration
- `announce` — narrate the action as it executes
- `confirm` — pause execution until user explicitly approves

### AI Decision → Execution Mode Mapping

The LLM emits one of five AI decisions. `processor.js` maps each to an execution mode and a default marker:

| AI Decision | Execution Mode | Default Marker | Notes |
|---|---|---|---|
| `EXECUTE` | `execute` | `silently` or `announce` | Standard action with system side-effects. |
| `REQUEST_CONFIRMATION` | `execute` | `confirm` | Execution is paused until the user explicitly approves. The `confirm` marker is the runtime implementation of `REQUEST_CONFIRMATION`. |
| `REFUSE` | `refuse` | — | No execution. Structured refusal emitted. |
| `RETURN_DATA` | `data` | — | Information retrieval; no side-effects. |
| `RETURN_UI` | `ui` | — | Visual output rendered via UI pipeline; no execution. |

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

## Agent Mode

Long-running tasks use `createAgentHandle(plan)` from `orchestrator.js`.

Every agent handle exposes:

- `handle.state` — observable `AGENT_STATE` (PENDING | RUNNING | PAUSED | COMPLETED | FAILED | ABORTED)
- `handle.progress` — `{ currentStep, totalSteps, results }`
- `handle.abort()` — requests abort at the next step boundary
- `handle.run()` — starts execution, resolves when complete or aborted
- `handle.onStep` — optional callback fired after each completed step

No hidden background loops. State is observable. User can interrupt.

## Core Module Structure

```text
src/
├── brain/                       # Intelligence core
│   ├── protocol.js              # Single source of truth: all protocol constants v2.0
│   │                            #   RETURN_TYPES, EXECUTION_MARKERS, EXECUTION_MODES,
│   │                            #   AI_DECISIONS, UI_SCHEMA_TYPES, MEMORY_OPERATIONS,
│   │                            #   WORKFLOW_STAGES, AGENT_STATES, LIFECYCLE_HOOKS
│   ├── llm.js                   # Gemini API client; streaming, key rotation, session management
│   ├── processor.js             # Protocol parser: extracts [speak], [silent], [ui], [action:], [plan]
│   │                            #   Classifies execution mode and engaged pipeline stages
│   ├── orchestrator.js          # Plan executor: lexes steps, resolves $variables, serial execution
│   │                            #   createAgentHandle: long-running task with observable state + interrupt
│   ├── system-prompt.js         # Builds LLM context from memory + skill registry
│   │                            #   Governance v2.0: role, execution contract, refusal contract,
│   │                            #   UI contract, memory contract, decomposition rules
│   ├── memory.js                # Named-bucket key-value store persisted to disk
│   │                            #   mutate(): explicit mutation contract API
│   ├── services.config.js       # Third-party service configuration (ElevenLabs, Gemini)
│   └── settings.js              # User preference schema and defaults
│
├── skills/                      # Capability execution environment
│   ├── registry.js              # In-memory skill map; builds prompt metadata; enable/disable state
│   ├── loader.js                # Auto-discovers core/ + ~/.venesa/capabilities/; fires lifecycle hooks
│   ├── validator.js             # Validates capability shape against protocol; enforces Zod schemas
│   ├── core/                    # Built-in capabilities (always loaded)
│   └── internal/                # Internal meta-skills (not injected into system prompt)
│
├── platform/                    # Electron main-process bindings
│   ├── main.js                  # App bootstrap: windows, global shortcuts, tray
│   ├── ui-pipeline.js           # Routes structured payloads from skills to the correct renderer
│   ├── model-server.js          # Vosk model server lifecycle
│   ├── capability-installer.js  # Downloads, validates, installs community capabilities
│   ├── tray.js                  # System tray icon and context menu
│   ├── ipc/                     # IPC channel handlers (main-process side)
│   │   ├── query-handlers.js    # Text query lifecycle
│   │   ├── voice-handlers.js    # Voice query lifecycle + TTS coordination
│   │   ├── action-handlers.js   # Direct skill invocations and plan execution
│   │   └── system-handlers.js   # Settings CRUD, capability management, app controls
│   ├── preload/                 # Context-bridged preload scripts per window
│   ├── speech/                  # Audio I/O (stt.js, tts.js, wake-word.js)
│   └── windows/                 # BrowserWindow factory functions
│
├── lib/                         # Stateless utility libraries
│   ├── logger.js                # Structured logger with levels and file output
│   ├── paths.js                 # OS-aware path resolution
│   ├── event-bus.js             # Internal pub/sub event bus
│   ├── key-pool.js              # API key rotation pool
│   ├── key-store.js             # Secure on-disk key storage (electron safeStorage)
│   └── powershell.js            # Sandboxed PowerShell execution wrapper
│
└── renderer/                    # Renderer process files (HTML/JS — no Node access)
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

All communication between renderer processes and the main Node.js process goes through typed IPC channels. Renderers have **no Node.js access** — preload scripts expose a minimal, explicitly-allowed API surface via `contextBridge`.

| Handler File         | Responsibility                                                |
| -------------------- | ------------------------------------------------------------- |
| `query-handlers.js`  | Text query lifecycle, streaming chunks to UI                  |
| `voice-handlers.js`  | Voice query lifecycle, TTS audio playback coordination        |
| `action-handlers.js` | Direct skill invocations, plan status events                  |
| `system-handlers.js` | Settings CRUD, capability install/remove/toggle, app controls |

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
processor.js dispatches → registry → validator.js runs Zod parse → handler(validatedParams)
```

Community capabilities go through identical validation. Origin (core vs community) has no effect on runtime behaviour. A broken capability cannot crash the system — each handler runs in an isolated try-catch boundary.

## System Contracts

- **AI is the Planner:** The runtime executes. Skill handlers are strictly passive implementations. The model controls parameter assignment, step ordering, and execution decisions.
- **No Hardcoded Capability Logic:** Core must not depend on any specific capability. All behaviors derive from skill metadata and protocol constants.
- **Capability-Agnostic Core:** Capabilities are plugins adhering to a strict schema. Broken capabilities cannot break the system.
- **Deterministic Interfaces:** Stable contracts. Versioned protocol. Strict validation before execution.
- **Explicit Memory Writes:** All memory mutations go through `memory.mutate()`. No implicit writes.
- **Observable Agent State:** Long-running tasks expose lifecycle handles. No hidden background loops.
- **Sandboxed Extensibility:** Community capabilities run in isolated dependency space. UI sandboxed. Execution guarded.
- **No Hidden Defaults:** All behaviour is driven by settings and skill metadata. Nothing hardcoded in the orchestration layer.
