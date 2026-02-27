# Venesa Standards

## Universal Protocol

One protocol governs all intelligence behavior:
- **Response structure**: `[speak]`/`[silent]` for voice, plain text + `[action:]` for text
- **Tool invocation**: `[action: name, param: value]` or `[plan]...[/plan]`
- **UI rendering**: `[ui]...[/ui]` for GitHub-decoded markdown
- **Return types**: Every plugin declares `returnType` (data/action/ui/memory/hybrid)
- **Execution markers**: `silently`, `announce`, `confirm`

### Execution Marker Definitions

| Marker | Semantics | Behavior |
|--------|-----------|----------|
| `silently` | Background execution | No UI feedback, no notification. Used for memory writes, data fetches. Idempotent — safe to retry. |
| `announce` | User-visible operation | Result shown in UI or spoken. Used for app launches, file operations. Logs to interaction history. |
| `confirm` | Requires user approval | Execution paused until user confirms. Used for destructive actions (delete, shutdown, wifi-passwords). |

Implementations set markers via the `marker` metadata field on each skill/plugin or per-step in a `[plan]`. The orchestrator reads the marker to decide notification behavior.

## Plugin Standard

Every plugin MUST declare:
- `name` — unique camelCase identifier
- `description` — human-readable, injected into AI prompt
- `returnType` — one of: `data`, `action`, `ui`, `memory`, `hybrid`
- `schema` — Zod schema for parameter validation (essential, not optional)
- `handler` — async function accepting validated params

Optional fields: `ui`, `marker`, `tags`, `config`, `lifecycle`, `enabled`

See `plugins/README.md` for full specification.

## Code Standards

- **Naming**: camelCase for files and functions, PascalCase forbidden in filenames
- **Modules**: CommonJS (`require`/`module.exports`)
- **Error handling**: Try-catch in all handlers, never crash the app
- **Logging**: Use `lib/logger.js`, never raw `console.log` in production code
- **Security**: Validate all user inputs, sandbox PowerShell, restrict file paths to home directory
- **No hard-coding**: Derive behavior from skill metadata and protocol constants

## Governance

- User has absolute authority over configuration, extensions, and behavior
- Settings stored in `.venesa-settings.json` per-user
- Plugin enable/disable persisted in memory `aliases.pluginStates`
- All system behavior configurable, no hidden defaults
