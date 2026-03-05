# Venesa Standards

**Governance:** Venesa Governance & Execution Contract v2.0
**Protocol Version:** 2.0

## Foundational Rules

1. **Generic Over Specific** — No capability names hardcoded into prompts. No workflow assumptions baked into the system.
2. **Strict Yet Flexible** — Strict contracts. Strict schema validation. Strict execution pipeline. Flexible interpretation of user intent within those constraints.
3. **Divide and Conquer** — Every complex task is decomposed into small deterministic steps. The LLM plans. The runtime executes.
4. **UI as Intent, Not Decoration** — UI is optional. Only render when the output is structurally complex, requires user interaction, or visual layout meaningfully improves comprehension.

## Universal Protocol

One protocol governs all intelligence behaviour. Every capability, IPC handler, and orchestration step conforms to the same set of tokens and return types.

### Execution Syntax

| Token | Usage |
|---|---|
| `[speak]...[/speak]` | Exact string routed to TTS. Voice mode only. |
| `[silent]...[/silent]` | Wraps background instructions. Content hidden from UI; actions inside still execute. |
| `[action: name, param: value]` | Invokes a single registered skill by its `name`. |
| `[plan]...[/plan]` | Multi-step workflow. Each step is a `[step: name, param: value, marker: X, label: Y]` line. `label` is an **optional** human-readable string identifier for the step (e.g., `"login-flow"`, `"verify-email"`). Allowed characters: alphanumerics, hyphens, and spaces. `label` is descriptive metadata used for logs, analytics, and debugging — it is **not** rendered in the UI. Use `label` for descriptive step names, aggregation, and external references. Use `marker` (a single-character or keyword machine-oriented token such as `silently`, `announce`, or `confirm`) for compact visual/execution markers. `label` is optional and has no uniqueness constraint; `marker` governs execution behaviour. |
| `[ui]...[/ui]` | GitHub-flavoured markdown block rendered natively in the interface. |

### Execution Modes

Classified by `processor.js` per response:

| Mode | Meaning |
|---|---|
| `execute` | Action steps with system side-effects |
| `data` | Information retrieval, no side-effects |
| `ui` | Visual output without execution |
| `refuse` | Structured refusal — no execution |

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

A refusal must not apologize, elaborate unnecessarily, or suggest workarounds unless directly relevant.

### Execution Markers

| Marker | Semantics | Behaviour |
|---|---|---|
| `silently` | Background execution | No UI feedback, no notification. |
| `announce` | User-visible operation | Result shown in UI or spoken aloud. |
| `confirm` | Requires user approval | Execution paused until user explicitly approves. Required for destructive actions. |

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

Every operation must traverse all 7 stages in order. No stage may be skipped.

1. `INTENT_PARSING`
2. `FEASIBILITY_EVALUATION`
3. `PLAN_CONSTRUCTION`
4. `STEP_EXECUTION`
5. `RESULT_STRUCTURING`
6. `UI_RENDERING`
7. `MEMORY_UPDATE`

#### Workflow Pipeline — Error Handling

| Stage | On Failure |
|---|---|
| `INTENT_PARSING` | Abort pipeline; return structured refusal. |
| `FEASIBILITY_EVALUATION` | Abort pipeline; return structured refusal with reason. |
| `PLAN_CONSTRUCTION` | Abort pipeline; return structured refusal. |
| `STEP_EXECUTION` | Abort remaining steps; rollback/compensate already-executed steps where possible. All step operations must be idempotent or provide a compensating action. |
| `RESULT_STRUCTURING` | Return a degraded result with available data; never silently drop data. |
| `UI_RENDERING` | Degrade gracefully (omit UI block); do not abort the response pipeline. |
| `MEMORY_UPDATE` | Log the failure; do not abort the response. Memory writes are best-effort but must not silently corrupt state. |

**Error propagation:** Errors are returned as structured objects `{ success: false, error: string }`. Do not throw unhandled exceptions across stage boundaries.

**Retry policy:** `STEP_EXECUTION` steps that fail due to transient errors (network, timeout) may be retried up to 2 times with exponential backoff (base 500 ms, max 4 s). `INTENT_PARSING`, `FEASIBILITY_EVALUATION`, and `PLAN_CONSTRUCTION` are non-retryable — re-querying the LLM is the recovery path. `UI_RENDERING` and `MEMORY_UPDATE` are not retried; failures are logged and skipped.

**Logging and metrics:** Every stage failure must be logged via `lib/logger.js` at `logger.error` level with the stage name, capability name (if applicable), error class (`transient` | `permanent`), and error message.

**Canonical failure response:** `{ success: false, stage: 'STAGE_NAME', error: 'message' }`

**Transient vs permanent:** Network/timeout/registry rate-limit errors are transient. Schema violations, refusals, and CVE-blocked packages are permanent. Transient errors back off and retry; permanent errors abort immediately.

**Timeouts:** Each stage must complete within 30 s. Stages that exceed the timeout are treated as transient failures and aborted.

### Agent Mode

Long-running tasks use `createAgentHandle(plan)` from `orchestrator.js`.

Rules:
- State must be observable via `handle.state`.
- User must be able to interrupt via `handle.abort()`.
- No hidden background loops without lifecycle control.

---

## Capability Standard

Every capability MUST export an object with these fields:

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | ✅ | `string` | Unique camelCase identifier. Used as the token name in `[action: name]`. |
| `description` | ✅ | `string` | Human-readable description injected verbatim into the LLM system prompt. Be precise — the model uses this to decide when to call the capability. |
| `returnType` | ✅ | `string` | One of `data`, `action`, `ui`, `memory`, `hybrid`. Declared in `protocol.js`. |
| `schema` | ✅ | `ZodObject` | Zod schema for all parameters. Validation runs before the handler is called. Never skip. |
| `handler` | ✅ | `async fn` | `async (validatedParams) => result`. Receives Zod-parsed params. Must not throw unhandled. |
| `marker` | — | `string` | Default execution marker. Overridable per-step in a plan. |
| `ui` | — | `string` | Structured UI component hint: `table`, `key-value`, `card-list`, `command-list`. |
| `tags` | — | `string[]` | Discoverability tags for the community browser. |
| `config` | — | `object` | Static configuration values (e.g., allowed paths, timeouts). |
| `lifecycle` | — | `object` | Hooks: `onLoad`, `onUnload`, `onEnable`, `onDisable`. |
| `enabled` | — | `boolean` | Default enabled state. Defaults to `true` if omitted. |
| `dependencies` | — | `string[]` | Optional npm package specifiers. **Exact versioned names only** (e.g., `"axios@1.7.9"`). Unversioned names like `"axios"` are disallowed — every entry must include an explicit version. No ranges (`^`, `~`, `>=`, etc.). Each capability gets its own isolated `node_modules` directory under `~/.venesa/capabilities/<capabilityName>/node_modules/`, fully separated from every other capability and from the host app. |

#### Security — Dependency Management

- **Exact versions required.** Every dependency entry must be an exact specifier (`name@x.y.z`). Floating ranges are rejected at validation time.
- **Name and version allowlisting.** Capability loaders must validate that package names match the pattern `^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$` and that versions are semver-exact before passing them to the dep engine.
- **CVE scanning.** Pinned versions must be scanned for known vulnerabilities via a publish-time CVE scan (e.g., `npm audit`, Snyk, or OSS-index) before publishing a capability. `dep-manager` must fail publish if any CVE is detected. When a CVE is identified post-publish, the capability author must release a new version with the patched dependency.
- **Transient vs permanent failure classification.** `dep-manager` categorises install failures before incrementing the failure counter:
  - *Transient*: network errors, timeouts, registry rate-limits — retried with exponential backoff (base 1 s, doubling, max 3 attempts) before counting as a failure.
  - *Permanent*: invalid package name/version, CVE-blocked package, schema validation rejection — counted as a failure immediately, no retries.
- **Failure backoff before corruption.** Installations that reach `MAX_FAILURES` consecutive failures do not mark corrupted immediately. After `MAX_FAILURES` (3) failures a cooldown period of 10 minutes is enforced before any further install attempt. If the attempt after cooldown also fails, the capability is marked corrupted and halted.
- **Reinstall recovery.** A user or automated task triggers reinstall by: (1) calling the `reinstall-capability` IPC action, which resets `dep-failures.json` for that capability and re-runs `installDepsForCapability`; or (2) deleting `dep-failures.json` manually and restarting. The `dep-failures.json` file is reset to `{}` for the affected capability on a successful reinstall.
- **Transitive dependency audit.** `dep-manager` uses `pacote` to recursively resolve the full transitive dependency graph. Authors are responsible for auditing the entire closure. Integration with `npm audit` or Snyk is recommended as part of the publish pipeline.
- **Failure logging.** All failures are logged via `lib/logger.js` with: capability name, package spec, error class (`transient` | `permanent`), and current retry/cooldown state.

### Capability Template

```js
const { z } = require('zod');

module.exports = {
  name: 'capabilityName',           // camelCase, unique
  description: 'What it does.',     // injected into LLM prompt
  returnType: 'action',             // data | action | ui | memory | hybrid
  marker: 'announce',               // silently | announce | confirm
  // dependencies: ['axios@1.7.9'], // optional — exact versions only, no ranges
  schema: z.object({
    param: z.string().describe('Parameter description for the model.'),
  }),
  handler: async ({ param }) => {
    try {
      // perform work
      return { success: true, result: param };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};
```

### Lifecycle Hooks

```js
lifecycle: {
  onLoad:     () => { /* called once when the skill is registered */ },
  onUnload:   () => { /* called when the skill is removed at runtime */ },
  onEnable:   () => { /* called when the user enables the skill */ },
  onDisable:  () => { /* called when the user disables the skill */ },
},
```

---

## Code Standards

### Language & Modules
- **Module system:** CommonJS only (`require` / `module.exports`). No ES module syntax (`import`/`export`).
- **Language:** JavaScript (Node.js compatible). No TypeScript in core or skill files.
- **Async:** Always use `async/await`. Avoid raw Promise chains.

### Naming
- **Files:** `kebab-case` (e.g., `launch-app.js`, `key-pool.js`). No PascalCase filenames.
- **Functions & variables:** `camelCase`.
- **Constants:** `UPPER_SNAKE_CASE` for module-level immutable constants.
- **Capability names:** `camelCase`, unique across the entire registry.

### Error Handling
- Every `handler` function must wrap its body in a `try/catch`.
- On error, return `{ success: false, error: err.message }` rather than throwing.
- Never let a single capability crash terminate the main process.
- Use `lib/logger.js` for all error logging — `logger.error(...)`, `logger.warn(...)`.

### Logging
- Use `lib/logger.js` exclusively. Never use raw `console.log` in production code paths.
- Log levels: `logger.info`, `logger.warn`, `logger.error`, `logger.debug`.
- Include module context in messages: `[module-name] message`.

### Security

**Input validation:**
- All capability inputs are Zod-validated before reaching the handler. Do not access `params` before validation.
- Sanitize any string that will be interpolated into shell commands or file paths.

**File system access:**
- Access is restricted to an explicit allowlist of directories: the user's home directory and its subdirectories.
- Any path access outside the allowlist must be explicitly justified and validated at runtime using `lib/paths.js` utilities.
- Never construct file paths by raw string concatenation with user input.

**Shell execution:**
- PowerShell execution goes through `lib/powershell.js` which applies sandboxing and restriction policies.
- Never call `child_process.exec` or `spawn` directly in capabilities. Use the provided wrapper.
- Destructive shell commands (format, rm -rf equivalents) must use the `confirm` marker.

**API keys:**
- Never log or surface API keys. Read from environment or `lib/key-store.js` only.
- Key rotation is handled automatically by `lib/key-pool.js`.

### No Hard-Coding
- Derive all runtime behaviour from skill metadata and protocol constants in `brain/protocol.js`.
- No capability name strings hard-coded in the orchestration layer.
- No model-specific logic outside `brain/llm.js`.

---

## IPC Standards

- All renderer ↔ main communication uses named IPC channels defined in the preload scripts.
- Renderers have zero Node.js access — the `contextBridge` API surface is the only allowed communication path.
- IPC handlers must validate all incoming payloads before acting.
- Sensitive operations (writing settings, installing capabilities) are handled exclusively in `system-handlers.js` on the main process.

---

## Governance

- **User authority:** Users have absolute authority over configuration, capability state, and assistant behaviour.
- **Settings persistence:** User settings stored in `.venesa-settings.json` via `brain/settings.js`.
- **Memory persistence:** `~/.venesa/` — named bucket files: `preferences.json`, `history.json`, `aliases.json`, `context.json`.
- **Memory writes:** All mutations go through `memory.mutate({ bucket, operation, key, value })`. No implicit writes.
- **Capability state:** Enable/disable state persisted to the `aliases` memory bucket under the key `capabilityStates`. Changes take effect immediately and survive restarts.
- **No hidden defaults:** All defaults documented in `brain/settings.js`. Nothing silently overridden at runtime.
- **Capability-agnostic core:** Core must not depend on any specific capability. Capabilities are plugins. Broken plugins cannot crash the system.
- **Agent mode:** Long-running tasks expose lifecycle handles with observable state and user-interruptible execution.
- **Deterministic interfaces:** Stable contracts. Versioned protocol. Strict validation before execution.
