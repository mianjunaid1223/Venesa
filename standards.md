# Venesa Standards

## Universal Protocol

One protocol governs all intelligence behaviour. Every capability, IPC handler, and orchestration step conforms to the same set of tokens and return types.

### Response Tokens

| Token | Usage |
|---|---|
| `[speak]...[/speak]` | Exact string routed to TTS. Omit for text-only responses. |
| `[silent]...[/silent]` | Wraps background reasoning. Content hidden from UI; actions inside still execute. |
| `[action: name, param: value]` | Invokes a single registered skill by its `name`. |
| `[plan]...[/plan]` | Multi-step workflow. Each step is a `[step: name, param: value, marker: X]` line. |
| `[ui]...[/ui]` | GitHub-flavoured markdown block rendered natively in the interface. |

### Execution Markers

| Marker | Semantics | Behaviour |
|---|---|---|
| `silently` | Background execution | No UI feedback, no notification. Used for memory writes, data fetches. Idempotency is the capability author's responsibility when retries are required. |
| `announce` | User-visible operation | Result shown in UI or spoken aloud. Used for app launches, file operations. Logs to interaction history. |
| `confirm` | Requires user approval | Execution paused until user explicitly approves. Required for destructive actions (delete, shutdown, exposing sensitive data). |

Markers are set via the `marker` field on each skill or per-step inside a `[plan]`. The orchestrator reads the marker to decide notification behaviour. Per-step markers override the skill default.

### Return Types

| Type | Meaning | Typical Usage |
|---|---|---|
| `data` | Returns structured data for the LLM to reason about | File search results, clipboard content, memory reads |
| `action` | Performs a system mutation or side-effect | App launch, volume change, file write |
| `ui` | Returns a renderable UI payload | Tables, card lists, key-value grids |
| `memory` | Suggests context persistence | Writing preferences, storing aliases |
| `hybrid` | Combination of two or more types | Data + UI (e.g. system resource monitor) |

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
- **CVE scanning.** Pinned versions must be scanned for known vulnerabilities (e.g., `npm audit` or equivalent) before publishing a capability. When a CVE is identified, the capability author must release a new version with the patched dependency; installations that exceed `MAX_FAILURES` consecutive failures are marked corrupted and halted. `MAX_FAILURES` is a fixed constant (value: **3**) defined in `dep-manager` and is not configurable via environment variables or external config files.
- **Transitive dependency risk.** `dep-manager` uses pacote to recursively resolve the full transitive graph. Authors are responsible for auditing their entire closure, not only direct dependencies.
- **Installation failure behaviour.** Failed installs increment a `consecutiveFailureCount` per package specifier, persisted in `dep-failures.json` at `~/.venesa/capabilities/<capabilityName>/dep-failures.json` (one file per capability, managed by `dep-manager`). The `consecutiveFailureCount` resets to `0` on a successful install for that specifier and increments by `1` on each failed attempt. Once `consecutiveFailureCount` reaches `MAX_FAILURES` (3), the capability is marked corrupted and no further install attempts are made until the capability is explicitly reinstalled. All failures are logged via `lib/logger.js` with full context (capability name, package spec, error message).

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
- **Memory persistence:** `~/.venesa/memory.json` — buckets: `preferences`, `history`, `aliases`, `reminders`.
- **Capability state:** Enable/disable state persisted to the `aliases` memory bucket under the key `capabilityStates`. Changes take effect immediately and survive restarts.
- **No hidden defaults:** All defaults are documented in `brain/settings.js`. Nothing is silently overridden at runtime.
