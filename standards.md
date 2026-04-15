# Venesa Standards

**Protocol Version:** 2.0

## Foundational Rules

1. **Generic Over Specific** - No capability names hardcoded into prompts. No workflow assumptions baked into the system.
2. **Strict Yet Flexible** - Strict contracts. Strict schema validation. Strict execution pipeline. Flexible interpretation of user intent within those constraints.
3. **Divide and Conquer** - Every complex task is decomposed into small deterministic steps. The LLM plans. The runtime executes.
4. **UI as Intent, Not Decoration** - UI is optional. Only render when the output is structurally complex, requires user interaction, or visual layout meaningfully improves comprehension.

## Universal Protocol

One protocol governs all intelligence behaviour. Every capability, IPC handler, and orchestration step conforms to the same set of tokens and return types.

### Execution Syntax

| Token | Usage |
|---|---|
| `[speak]...[/speak]` | Exact string routed to TTS. Voice mode only. |
| `[silent]...[/silent]` | Wraps background instructions. Content hidden from UI; actions inside still execute. |
| `[action: name, param: value]` | Invokes a single registered skill by its `name`. |
| `[plan]...[/plan]` | Multi-step workflow. Each step is a `[step: name, param: value, marker: X, label: Y]` line. |
| `[ui]...[/ui]` | GitHub-flavoured markdown block rendered natively in the interface. |

### Execution Modes

Classified by `processor.js` per response:

| Mode | Meaning |
|---|---|
| `execute` | Action steps with system side-effects |
| `data` | Information retrieval, no side-effects |
| `ui` | Visual output without execution |
| `refuse` | Structured refusal - no execution |

### AI Decision Contract

The LLM must emit exactly one decision per request:

| Decision | When |
|---|---|
| `EXECUTE` | Request is feasible; emit execution steps |
| `REQUEST_CONFIRMATION` | Request is destructive or ambiguous; confirm before executing |
| `REFUSE` | Request is unsafe, infeasible, or requires unavailable resources |
| `RETURN_DATA` | Informational; return data without side-effects |
| `RETURN_UI` | Requires visual output; return UI without execution |

### Refusal Contract

Refusal is structured, not conversational. Format: `"Cannot [action]: [single-sentence reason]."`

### Execution Markers

| Marker | Semantics | Behaviour |
|---|---|---|
| `silently` | Background execution | No UI feedback, no notification. |
| `announce` | User-visible operation | Result shown in UI or spoken aloud. |
| `confirm` | Requires user approval | Execution paused until user explicitly approves. |

### Return Types

| Type | Meaning |
|---|---|
| `data` | Fetches information; AI waits for result to reason about |
| `action` | Performs a system mutation or side-effect |
| `ui` | Returns a renderable UI payload |
| `memory` | Reads/writes internal state; never surfaced to user |
| `hybrid` | Combination of two or more types |

### Memory Mutation Contract

All memory writes must be explicit. No implicit writes.

Contract: `{ bucket, operation: 'set'|'append'|'remove', key, value }`

API: `memory.mutate({ bucket, operation, key, value })`

### Workflow Pipeline

Every operation traverses all 7 stages in order:

1. `INTENT_PARSING`
2. `FEASIBILITY_EVALUATION`
3. `PLAN_CONSTRUCTION`
4. `STEP_EXECUTION`
5. `RESULT_STRUCTURING`
6. `UI_RENDERING`
7. `MEMORY_UPDATE`

### Error Handling

- On failure in `INTENT_PARSING` → `PLAN_CONSTRUCTION`: abort pipeline, return structured refusal.
- On failure in `STEP_EXECUTION`: abort remaining steps, return error with any partial results.
- On failure in `UI_RENDERING` or `MEMORY_UPDATE`: log and continue, don't abort the response.
- All errors returned as `{ success: false, error: string }`.
- Never throw unhandled exceptions across stage boundaries.

---

## Capability Standard

Every capability MUST export an object with these fields:

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | ✅ | `string` | Unique camelCase identifier. Used in `[action: name]`. |
| `description` | ✅ | `string` | Injected into LLM system prompt. Be precise. |
| `returnType` | ✅ | `string` | `data`, `action`, `ui`, `memory`, or `hybrid`. |
| `schema` | ✅ | `ZodObject` | Zod schema for all parameters. Validated before handler. |
| `handler` | ✅ | `async fn` | `async (validatedParams) => result`. Must not throw unhandled. |
| `marker` | - | `string` | Default execution marker (`silently`, `announce`, `confirm`). |
| `ui` | - | `string` | Structured UI hint: `table`, `key-value`, `card-list`, `command-list`. |
| `tags` | - | `string[]` | Discoverability tags. |
| `examples` | - | `array` | `{ user, action }` pairs to teach the LLM. |
| `lifecycle` | - | `object` | Hooks: `onLoad`, `onUnload`, `onEnable`, `onDisable`. |
| `dependencies` | - | `string[]` | npm packages, exact versions only (e.g., `"axios@1.7.9"`). |

See [PLUGINS.md](PLUGINS.md) for the full developer guide with examples.

### Dependency Isolation

Community capabilities may declare npm dependencies:
- **Exact versions required** — no `^`, `~`, or `>=` ranges.
- Each capability gets its own `node_modules` under `~/.venesa/capabilities/<name>/node_modules/`.
- The loader patches `Module._resolveFilename` so `require()` from capabilities checks their local `node_modules` first.

---

## Code Standards

### Language & Modules
- **Module system:** CommonJS only (`require` / `module.exports`).
- **Language:** JavaScript (Node.js compatible). No TypeScript.
- **Async:** Always use `async/await`. Avoid raw Promise chains.

### Naming
- **Files:** `kebab-case` (e.g., `launch-app.js`).
- **Functions & variables:** `camelCase`.
- **Constants:** `UPPER_SNAKE_CASE` for module-level immutable constants.
- **Capability names:** `camelCase`, unique across the entire registry.

### Error Handling
- Every `handler` function must wrap its body in a `try/catch`.
- On error, return `{ success: false, error: err.message }`.
- Never let a capability crash the main process.
- Use `lib/logger.js` for all error logging.

### Logging
- Use `lib/logger.js` exclusively. Never use `console.log` in production.
- Log levels: `logger.info`, `logger.warn`, `logger.error`, `logger.debug`.
- Include module context: `[module-name] message`.

### Security

**Token expansion:**
- The orchestrator resolves all `{{token}}` placeholders before calling handlers. Capabilities must never import `token-resolver`.

**Input validation:**
- All inputs are Zod-validated before reaching the handler.
- Sanitize strings that go into shell commands or file paths.

**Shell execution:**
- PowerShell goes through `lib/powershell.js` — persistent session, queued commands.
- **Never** call `child_process.exec` or spawn PowerShell directly.
- Use `powershell.execute(script, args, timeoutMs)`.

**API keys:**
- Never log or surface API keys. Use `lib/key-store.js` or `lib/key-pool.js`.

### No Hard-Coding
- All behaviour derives from skill metadata and `brain/protocol.js`.
- No capability names hard-coded in the orchestration layer.

---

## IPC Standards

- All renderer ↔ main communication uses named IPC channels via preload scripts.
- Renderers have zero Node.js access — `contextBridge` only.
- IPC handlers must validate all incoming payloads.
- Sensitive operations (settings, installations) handled in `system-handlers.js` only.

---

## Governance

- **User authority:** Users have absolute authority over configuration and behaviour.
- **Settings:** `~/.venesa/settings.json` via `brain/settings.js`.
- **Memory:** `~/.venesa/memory/` — buckets: `preferences.json`, `history.json`, `aliases.json`, `context.json`.
- **Memory writes:** All mutations via `memory.mutate()`. No implicit writes.
- **Capability state:** Enable/disable persisted in `aliases` bucket under `capabilityStates`.
- **No hidden defaults:** All defaults in `brain/settings.js`.
- **Capability-agnostic core:** Core must not depend on any specific capability. Broken plugins cannot crash the system.
