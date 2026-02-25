# Venesa Development Standards

This document defines the strict standards for modules, plugins, and pipelines within the Venesa architecture. All new developments must strictly adhere to these guidelines to maintain a deterministic, testable, and robust system.

## 1. Plugin (Skill) Standard Schema

All plugins MUST export a predefined structure representing their metadata, permissions, and handler. We use `zod` to enforce parameter typing and runtime validation.

### Required Fields:
- `name` (String): A unique camelCase ID used by the AI as a tool name.
- `description` (String): A clear, concise description of what the plugin does and exactly when to use it, which is injected into the AI system prompt.
- `ui` (String | null): The UI component directive to render on the frontend. Standard values: `'table'`, `'key-value'`, `'card-list'`, `'command-list'`, or `null`.
- `schema` (Zod Object): A rigorous `zod` schema to validate the parameters requested by the AI.
- `handler` (Async Function): `async (params) => any`. The main execution function. Receives pre-validated `params`.

### Example Plugin (`sample-plugin.js`):
```javascript
const { z } = require('zod');

module.exports = {
    name: 'samplePlugin',
    description: 'prompt for ai on how to use it and what it is." or "show the sample plugin". Do NOT use for general UI questions.',
    ui: 'table', // table, key-value, card-list, etc.
    schema: z.object({
        query: z.string().optional().describe('The user query to demonstrate the plugin.'),
    }),
    handler: async (params) => {
        // params are guaranteed to match schema
        return {
            success: true,
            data: [{ id: 1, name: "Item", value: params.query }]
        };
    }
};
```

## 2. Orchestration & Execution

1. **Formal Parsing:** All actions MUST be emitted as `[action: actionName, paramName: paramValue]` or wrapped in `[plan]...[/plan]` for multi-step tasks. Do not process legacy JSON arrays for actions.
2. **Deterministic Step Failure:** If a step in a `[plan]` fails, subsequent dependencies MUST be aborted. Error responses must be structured and fed back to the orchestrator.
3. **Execution Results:** All executed actions via `executeAction` must return a structured payload:
```typescript
{
  success: boolean,
  output: any,
  error?: string
}
```

## 3. Module & Pipeline Mechanisms
- **State Management:** Avoid global mutable state in plugins. If state must be preserved, delegate to `brain/memory.js`.
- **Dependency Tracking:** Parameters that start with `$` denote a dynamically resolved dependency from a previous step's output. The pipeline evaluates these before injecting them into the handler.
- **Fail-Fast:** Validate early using the registry's centralized input validation instead of adding ad-hoc checks in every handler.
