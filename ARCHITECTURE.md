# Architecture Manual

## Overview

Venesa is engineered as a **programmable intelligence platform**, breaking away from conversational chatbots. All operations strictly adhere to a highly unified protocol overseeing intelligent behavioral modeling, execution parsing, component rendering, and multi-step workflow synchronization.

## Processing Pipeline

The intelligence routing relies on a structured, five-tier execution pipeline:

```text
User Input -> Context Resolution -> Reasoning Engine (LLM) -> Protocol Parser -> System Execution -> Output
```

### Stage Breakdown

1. **Input Ingestion:** Audio streams (transcribed via STT) or text input interfaces capture the user request. A mode-specific prompt wrapper provides boundaries for the query.
2. **Reasoning Engine:** The LLM produces a highly structured response using specific syntax tokens (`[speak]`, `[action:]`, `[plan]`, `[ui]`, `[silent]`), alongside human-readable text.
3. **Protocol Parser & Execution:** The orchestrator digests the instruction tags, invoking registered skills asynchronously. The execution layer respects internal routing paths dynamically (`data`, `action`, `ui`, `memory`, `hybrid`).
4. **Voice Emulation:** Extracted `[speak]` tokens are piped through the Text-to-Speech (TTS) engine.
5. **Interface Rendering:** Text responses and `[ui]` markers are rendered natively in the DOM using a custom GitHub-style Markdown implementation.

### Protocol Tokens vs Execution Markers

The architecture explicitly differentiates between **Reasoning Tokens** (how the AI shapes the data) and **Execution Markers** (how the orchestrator surfaces progress).

| Reasoning Token | Purpose | Execution Handling |
| --- | --- | --- |
| `[speak]...[/speak]` | Dictates the exact string passed to TTS | Not tracked as an execution step |
| `[silent]...[/silent]` | Obscures internal thoughts from output | Wraps operations to hide logs |
| `[action: tool]` | Invokes an atomic skill by name | Inherits the skill's default visibility |
| `[step: tool, marker: silently]` | Orchestrates a plan sequence | Suppresses user notifications entirely |
| `[step: tool, marker: announce]` | Orchestrates a plan sequence | Exposes execution output to UI/TTS |
| `[step: tool, marker: confirm]` | Orchestrates a plan sequence | Freezes execution pending user input |

## Core Module Structure

```text
src/
├── brain/                    # Intelligence core
│   ├── protocol.js           # Single source of truth for routing schemas
│   ├── llm.js                # API network client handling sessions
│   ├── processor.js          # AST-style parser resolving LLM output
│   ├── orchestrator.js       # Executes serialized multi-dependency plans
│   ├── system-prompt.js      # Translates the active module state into context
│   ├── memory.js             # Autonomous data persister (preferences, history)
│   └── settings.js           # Encrypted user preference definitions
│
├── skills/                   # Execution environment schemas
│   ├── registry.js           # Manages memory allocation for loaded skills
│   ├── loader.js             # Event hooking and module auto-discovery
│   ├── validator.js          # Enforces Zod compliance strictly on boundary
│   └── core/                 # Internal built-in capability definitions
│
├── platform/                 # Node environment and system bindings
│   ├── main.js               # Application bootstrap and daemon hooks
│   ├── ui-pipeline.js        # Payload routing for interface rendering
│   ├── ipc/                  # Multi-proc communication channels
│   └── speech/               # Audio input/output device routing
│
├── lib/                      # Stateless libraries
│   ├── logger.js             # Stream logging
│   └── paths.js              # Operating System path resolution
│
└── renderer/                 # Application view tier
    ├── main.window.html      # Center interface
    ├── voice.window.html     # Fluid floating overlay
    ├── settings.window.html  # Configuration view
    └── setup.window.html     # Bootloader view
```

## System Contracts

- **AI is the Decision-Maker:** Handlers and tools are strictly passive implementations; the model decides validation routing, parameter assignment, and sequential ordering.
- **Unified Formatting:** Data formatting is never handled by localized components. The AI controls the human-readable string outputs entirely.
- **Dynamic Capabilities Injection:** Internal execution prompts are built natively by interpolating the memory registry (`registry.getMetadataForPrompt()`).
- **Render Directives:** The model declares rich markup natively via `[ui]` bounds without executing DOM injections.
- **Silent Operations:** Automation happens securely and silently when the engine determines explicit confirmation is redundant.
- **Sandboxed Extensibility:** Core logic paths are immune against localized capability crashes or failures.
