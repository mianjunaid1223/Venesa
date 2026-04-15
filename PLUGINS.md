# Venesa Plugin Guide

How to create capabilities (plugins) for Venesa.

## What is a Capability?

A capability is a single `.js` file that teaches Venesa a new skill. It exports an object with a standard shape. When Venesa receives a user request, the LLM decides which capability to call and what parameters to pass. Your code handles the execution.

**Core capabilities** live in `src/skills/core/`.  
**Community capabilities** go in `~/.venesa/capabilities/` (auto-discovered at startup).

## Required Structure

Every capability must export these fields:

```js
const { z } = require('zod');

module.exports = {
  // ── Required ──────────────────────────
  name: 'myCapability',                    // camelCase, unique across all skills
  description: 'Does something useful.',   // Injected into LLM prompt — be precise
  returnType: 'action',                    // data | action | ui | memory | hybrid
  schema: z.object({                       // Zod schema — validated before handler runs
    param: z.string().describe('What this param is for'),
  }),
  handler: async ({ param }) => {          // Receives Zod-validated params
    try {
      // Do work here
      return { success: true, result: 'done' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── Optional ──────────────────────────
  marker: 'announce',       // silently | announce | confirm
  tags: ['system', 'util'], // For discoverability
  ui: null,                 // table | key-value | card-list | command-list
  examples: [               // Helps the LLM know when to use this skill
    { user: 'do the thing', action: '[action: myCapability, param: value]' },
  ],
};
```

## Return Types

| Type | When to Use | Example |
|------|------------|---------|
| `data` | Fetching information — LLM will verbalize the result | IP address, system info, file content |
| `action` | Performing a side-effect — LLM confirms "Done" | Launch app, set volume, open file |
| `ui` | Returning structured visual data | Tables, card lists |
| `memory` | Reading/writing internal state (not shown to user) | Get/set memory |
| `hybrid` | Mix of data + action | Search files (returns data + may open) |

## Execution Markers

| Marker | Behavior |
|--------|----------|
| `silently` | Runs in background, no notification to user |
| `announce` | User sees/hears the result |
| `confirm` | Pauses until user approves (use for destructive actions) |

## How to Perform PC Operations

For Windows system tasks, use the shared PowerShell runner:

```js
const { runPowerShell, escapeForPowerShell } = require('./_shared');

async handler({ appName }) {
  const safeName = escapeForPowerShell(appName);
  const script = `Get-Process | Where-Object { $_.Name -like '*${safeName}*' }`;
  
  try {
    const result = await runPowerShell(script, [], 10000); // 10s timeout
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

**Key rules for PowerShell:**
- Always use `runPowerShell()` from `_shared.js` — never spawn a new process
- Always escape user input with `escapeForPowerShell()`
- Add `-ErrorAction SilentlyContinue` for optional hardware queries (battery, GPU)
- Set a reasonable timeout (default: 30s)

## How the LLM Calls Your Skill

The LLM emits structured tags:

```
Single action:   [action: myCapability, param: value]
Multi-step plan:  [plan]
                  [step: searchFiles, marker: silently, query: *.txt]
                  [step: openFile, marker: announce, filePath: $step1.path]
                  [/plan]
```

Your `examples` array teaches the LLM when and how to call your skill. Write clear examples.

## Rules

1. **Always wrap handler in try/catch** — return `{ success: false, error }` on failure
2. **Never throw unhandled** — a broken skill must not crash the app
3. **Never import `token-resolver`** — the platform resolves `{{tokens}}` before calling you
4. **Never use `console.log`** — use `require('../../lib/logger')` for logging
5. **Schema is mandatory** — every param must be defined in a Zod schema
6. **Keep it simple** — prefer standard approaches you'd find on Google/StackOverflow

## Installing a Community Capability

Drop a `.js` file in `~/.venesa/capabilities/` and restart, or install via the Settings window.

If your capability needs npm packages, declare them:

```js
module.exports = {
  name: 'myCapability',
  dependencies: ['axios@1.7.9'],  // Exact versions only — no ^ or ~
  // ... rest of the capability
};
```

Dependencies are installed per-capability in `~/.venesa/capabilities/<name>/node_modules/`.

## Lifecycle Hooks (Optional)

```js
lifecycle: {
  onLoad:    () => { /* called when skill is registered at startup */ },
  onUnload:  () => { /* called when skill is removed */ },
  onEnable:  () => { /* called when user enables the skill */ },
  onDisable: () => { /* called when user disables the skill */ },
},
```

## Full Working Example

A capability that gets the current weather (using a free API):

```js
const { z } = require('zod');

module.exports = {
  name: 'getWeather',
  description: 'Get current weather for a city',
  returnType: 'data',
  marker: 'announce',
  tags: ['weather', 'info'],
  
  schema: z.object({
    city: z.string().describe('City name to get weather for'),
  }),

  examples: [
    { user: 'what is the weather in London', action: '[action: getWeather, city: London]' },
    { user: 'weather New York', action: '[action: getWeather, city: New York]' },
  ],

  async handler({ city }) {
    try {
      const https = require('https');
      const data = await new Promise((resolve, reject) => {
        https.get(
          `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
          (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
            res.on('error', reject);
          }
        ).on('error', reject);
      });

      const current = data.current_condition?.[0];
      if (!current) return { success: false, error: 'No weather data found' };

      return {
        success: true,
        city,
        temp_c: current.temp_C,
        temp_f: current.temp_F,
        condition: current.weatherDesc?.[0]?.value || 'Unknown',
        humidity: current.humidity,
        wind_mph: current.windspeedMiles,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};
```

When a user says "what's the weather in London", the LLM emits `[action: getWeather, city: London]`. Venesa validates the params, calls your handler, then verbalizes the result naturally.
