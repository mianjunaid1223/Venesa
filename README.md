# Venesa

<p align="center">
  <img src="assets/logo.png" alt="Venesa Logo" width="120" />
</p>

<p align="center">
  <strong>Venesa: An autonomous, programmable AI platform for Windows that seamlessly transforms natural language into executable system workflows.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2B-0078D6?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-28.0-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/Model-Gemini%202.5-4285F4?logo=google" alt="Gemini" />
  <img src="https://img.shields.io/badge/Speech-ElevenLabs-5436DA" alt="ElevenLabs" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

## Overview

Venesa is an advanced desktop intelligence engine for Windows that bridges the gap between natural language understanding and system-level execution. It operates through an autonomous pipeline that listens, formulates multi-step execution plans, and executes local system tasks without requiring strict procedural inputs. 

Users can invoke the assistant system-wide via a customizable wake word or a global hotkey (`Alt+Space`).

**Core Capabilities:**
- **System Automation:** Execute local configurations, launch applications, and manage files dynamically.
- **Task Orchestration:** Parse complex natural language requests into serialized, dependency-aware workflows.
- **Dynamic Interface Generation:** Render real-time data formats (tables, key-value grids, cards) through UI directives.
- **Modular Plugin Ecosystem:** Extend the AI's internal capabilities without altering core orchestration logic.
- **Speech Processing Pipelines:** Leverage ElevenLabs Scribe for transcription and Flash v2.5 for text-to-speech synthesis.

## System Orchestration

Venesa transcends traditional single-command chatbots by evaluating requests as programmable workflows. 

### Direct Execution
For atomic tasks, the system maps the query directly to an internal tool:
- "Launch Google Chrome" -> Resolves to the application framework.
- "Search for budget documents" -> Invokes the local file indexing module.
- "Set system volume to 50%" -> Calls the system control interface.

### Workflow Orchestration
For compounded requests, the language model formulates a serialized `[plan]` containing sequential steps, resolving dependencies via variables.
Example inputs:
- "Pull my clipboard history and search Google for the contents."
- "Close all active applications, lock my workspace, and set the volume to zero."
- "Monitor my system resources and list the top ten processes utilizing RAM."

### Execution Markers
Every executed function features a visibility marker to control user interruption or feedback:
- `silently`: Background execution with no output.
- `announce`: Verbose execution announcing the result via TTS or text.
- `confirm`: Action lock requiring explicit permission before executing destructive system queries.

## Architecture Highlights

The core architecture treats the language model as a reasoning engine rather than a text generator. The internal pipeline interprets LLM tags specifically:

- **State Management:** Stateless generation interactions, but heavily contextualized via persistent memory buckets (preferences, context, aliases).
- **Security:** Strict validation bounds on external queries and script executions (e.g., PowerShell restriction policies).
- **Extensibility:** The skill registry parses runtime plugins and dynamically injects schema representations into the reasoning engine's prompt.

Refer to [ARCHITECTURE.md](ARCHITECTURE.md) for a comprehensive deep-dive into the internal execution protocol.

## Prerequisites

- Windows 10 or 11
- Node.js environment (v18.0.0 or higher)
- pnpm package manager
- API Keys: Google Gemini, ElevenLabs

## Setup & Building

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mianjunaid1223/Venesa.git
   cd Venesa
   pnpm install
   ```

2. **Configure Environment:**
   Create a `.env` file referencing your required keys. Venesa supports automatic key-rotation to gracefully recover from rate-limiting events.
   ```env
   GEMINI_API_KEY=your_gemini_key
   ELEVENLABS_API_KEY=your_elevenlabs_key
   ```
   *(Appending _1, _2 to the key variables allows for automatic rotation).*

3. **Launch the Engine:**
   ```bash
   pnpm start
   ```

   For diagnostic streams and logging:
   ```bash
   pnpm dev
   ```

## Creating Plugins

Venesa employs a strictly typed plugin architecture. Tools are defined globally with Zod schema validation to ensure robust data parsing before reaching the execution layer. For detailed definitions on the unified protocol and lifecycles, read [plugins/README.md](plugins/README.md).

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE) for details.

---
<p align="center">
  Developed for the open-source community by <a href="https://github.com/mianjunaid1223">Mian Junaid</a>
</p>
