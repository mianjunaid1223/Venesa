# Venesa Standards

## Universal Protocol

One protocol governs all intelligence behavior:
- **Response structure**: `[speak]`/`silently` for voice, plain text + `[action:]` for text
- **Tool invocation**: `[action: name, param: value]` or `[plan]...[/plan]`
- **UI rendering**: `[ui]...[/ui]` for GitHub-decoded markdown
- **Return types**: Every capability declares `returnType` (data/action/ui/memory/hybrid)
- **Execution markers**: `silently`, `announce`, `confirm`

### Execution Marker Definitions

| Marker | Semantics | Behavior |
|--------|-----------|----------|
| `silently` | Background execution | No UI feedback, no notification. Used for memory writes, data fetches. Controls visibility only — idempotency is the responsibility of capability authors when retries are required. |
| `announce` | User-visible operation | Result shown in UI or spoken. Used for app launches, file operations. Logs to interaction history. |
| `confirm` | Requires user approval | Execution paused until user confirms. Used for destructive actions (delete, shutdown, wifi-passwords). |

Implementations set markers via the `marker` metadata field on each skill/capability or per-step in a `[plan]`. The orchestrator reads the marker to decide notification behavior.

## Capability Standard

Every capability MUST declare:
- `name` — unique camelCase identifier
- `description` — human-readable, injected into AI prompt
- `returnType` — one of: `data`, `action`, `ui`, `memory`, `hybrid`
- `schema` — Zod schema for parameter validation (essential, not optional)
- `handler` — async function accepting validated params

Optional fields: `ui`, `marker`, `tags`, `config`, `lifecycle`, `enabled`

See `capabilities/README.md` for full specification.

## Code Standards

- **Naming**: camelCase for files and functions, PascalCase forbidden in filenames
- **Modules**: CommonJS (`require`/`module.exports`)
- **Error handling**: Try-catch in all handlers, never crash the app
- **Logging**: Use `lib/logger.js`, never raw `console.log` in production code
- **Security**: Validate all user inputs, sandbox shell execution (e.g., restrict/virtualize any invoked shells), restrict file paths using a documented allowlist of permitted directories
  - **Threat model and allowed paths**: File path restrictions exist to prevent capabilities from reading/writing outside the user's intended scope. Permitted paths include the user's home directory and its subdirectories. Any path access outside the allowlist must be explicitly justified and validated at runtime.
- **No hard-coding**: Derive behavior from skill metadata and protocol constants

## Governance

- User has absolute authority over configuration, extensions, and behavior
- Settings stored in `.venesa-settings.json` per-user
- capability enable/disable state is kept in memory at runtime and persisted to disk via the memory system (bucket: `aliases`, key: `capabilityStates`). Changes take effect immediately on toggle and survive restarts through the memory persistence layer.
- All system behavior configurable, no hidden defaults
