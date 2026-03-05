# Venesa Governance v2.0 — Feature Testing Guide

Run all terminal commands from your Venesa installation directory.
On Windows, navigate to `%USERPROFILE%\Venesa` (e.g., `cd "%USERPROFILE%\Venesa"`).
On Unix/macOS, navigate to `$HOME/Venesa` (e.g., `cd "$HOME/Venesa"`).

---

## 1. Protocol v2.0 Constants

**What to test:** Every constant exported from `protocol.js` is present and has the right shape.

```powershell
node -e "
const p = require('./src/brain/protocol');
console.log('Version:', p.PROTOCOL_VERSION);
console.log('Stages:', Object.keys(p.WORKFLOW_STAGES).length, 'stages');
console.log('Modes:', Object.values(p.EXECUTION_MODES));
console.log('Agent states:', Object.values(p.AGENT_STATES));
console.log('Memory ops:', Object.values(p.MEMORY_OPERATIONS));
console.log('Markers:', Object.values(p.EXECUTION_MARKERS));
"
```

**Expected output:**
```
Version: 2.0
Stages: 7 stages
Modes: [ 'execute', 'data', 'ui', 'refuse' ]
Agent states: [ 'PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'ABORTED' ]
Memory ops: [ 'set', 'append', 'remove' ]
Markers: [ 'silently', 'announce', 'confirm' ]
```

---

## 2. Execution Mode Classification

**What to test:** `processResponse()` correctly classifies the LLM's output into an execution mode.

```powershell
node -e "
const { processResponse } = require('./src/brain/processor');

// Test 1: plan → execute mode
const r1 = processResponse('[plan]\n[step: launchApp, marker: announce, target: notepad, label: Open Notepad]\n[/plan]', 'text');
console.log('Plan mode:', r1.executionMode);          // execute

// Test 2: refusal → refuse mode
const r2 = processResponse('Cannot open that file: the path is outside allowed directories.', 'text');
console.log('Refusal mode:', r2.executionMode);       // refuse
console.log('Is refusal:', r2.isRefusal);              // true

// Test 3: spoken text only → data mode
const r3 = processResponse('The current time is 3:45 PM.', 'text');
console.log('Data mode:', r3.executionMode);           // data

// Test 4: ui block → ui mode
const r4 = processResponse('[ui]\n## Results\n| A | B |\n|---|---|\n| 1 | 2 |\n[/ui]', 'text');
console.log('UI mode:', r4.executionMode);             // ui
"
```

---

## 3. Pipeline Stage Tracking

**What to test:** `pipelineStages` in the response lists which of the 7 workflow stages were engaged.

```powershell
node -e "
const { processResponse } = require('./src/brain/processor');

const r = processResponse('[plan]\n[step: searchFiles, marker: announce, query: readme, label: Search for readme files]\n[/plan]', 'text');
console.log('Engaged stages:', r.pipelineStages);
// Should include INTENT_PARSING, FEASIBILITY, PLAN_CONSTRUCTION, STEP_EXECUTION
"
```

**Pass criteria:** The array is non-empty and contains recognisable stage names.

---

## 4. Structured Refusal Detection

**What to test:** The `isRefusal` flag is set correctly and `cleanResponse` contains the refusal text.

```powershell
node -e "
const { processResponse } = require('./src/brain/processor');

const cases = [
  'Cannot delete system files: this operation is not permitted.',
  'Cannot open that application: it is not installed on this system.',
  'This is just a normal reply.',
  'Sure, opening Notepad now.',
];

cases.forEach(c => {
  const r = processResponse(c, 'text');
  console.log(JSON.stringify({ input: c.slice(0,40), isRefusal: r.isRefusal, mode: r.executionMode }));
});
"
```

**Expected:** First two are `isRefusal: true, mode: 'refuse'`. Last two are `false`.

---

## 5. Memory — Explicit Mutation API (`mutate`)

**What to test:** The `mutate()` function correctly handles `set`, `append`, and `remove` operations with bucket isolation.

```powershell
node -e "
const memory = require('./src/brain/memory');

// SET
memory.mutate({ bucket: 'preferences', operation: 'set', key: 'testKey', value: 'hello' });
console.log('After set:', memory.get('preferences', 'testKey'));         // hello

// APPEND (to an array bucket item)
memory.mutate({ bucket: 'context', operation: 'set', key: 'items', value: ['a', 'b'] });
memory.mutate({ bucket: 'context', operation: 'append', key: 'items', value: 'c' });
console.log('After append:', memory.get('context', 'items'));            // ['a','b','c']

// REMOVE
memory.mutate({ bucket: 'preferences', operation: 'remove', key: 'testKey' });
console.log('After remove:', memory.get('preferences', 'testKey'));      // undefined or null

// Invalid operation — should throw or return error, not silently corrupt
try {
  memory.mutate({ bucket: 'preferences', operation: 'explode', key: 'x', value: 1 });
  console.log('ERROR: invalid op should have been rejected');
} catch(e) {
  console.log('Correctly rejected invalid op:', e.message);
}
"
```

---

## 6. Agent Mode — `createAgentHandle`

**What to test:** An agent handle is created, transitions through states, and can be aborted mid-run.

```powershell
node -e "
const { createAgentHandle } = require('./src/brain/orchestrator');

// Create a synthetic plan (no real tool calls — just state machine test)
const plan = [
  { tool: 'nonExistentTool', params: {}, marker: 'silently', label: 'Step 1' }
];

const handle = createAgentHandle(plan);
console.log('Initial state:', handle.state);      // PENDING

// Subscribe to step events
handle.onStep = (step) => console.log('Step event:', step);

// Run — will fail on nonExistentTool but should transition to FAILED, not crash
handle.run().then(() => {
  console.log('Final state:', handle.state);      // FAILED or COMPLETED
  console.log('Progress:', handle.progress);
}).catch(e => {
  console.log('Run error (acceptable):', e.message);
});
"
```

**Abort test:**

```powershell
node -e "
const { createAgentHandle } = require('./src/brain/orchestrator');
const plan = [];
const handle = createAgentHandle(plan);
handle.abort();
console.log('After abort:', handle.state);        // ABORTED
"
```

---

## 7. System Prompt — Personality Injection

**What to test:** The generated system prompt includes the personality section and it adapts based on memory state.

```powershell
node -e "
const getSystemPrompt = require('./src/brain/system-prompt');
const prompt = getSystemPrompt('TestUser', 'text');

// Check personality section is present
console.log('Has personality:', prompt.includes('## PERSONALITY'));
console.log('Has warm framing:', prompt.includes('warm'));
console.log('Has adaptation rule:', prompt.includes('communicationStyle'));

// Check role definition is still present
console.log('Has role definition:', prompt.includes('## ROLE'));

// Check execution contract is still present
console.log('Has execution contract:', prompt.includes('## EXECUTION CONTRACT'));

// Personality must come BEFORE execution contract (order check)
const personalityPos = prompt.indexOf('## PERSONALITY');
const executionPos = prompt.indexOf('## EXECUTION CONTRACT');
console.log('Personality before execution:', personalityPos < executionPos);
"
```

---

## 8. System Prompt — Voice Mode Structure

**What to test:** Voice mode prompt has `[speak]`/`[silent]` block instructions and personality.

```powershell
node -e "
const getSystemPrompt = require('./src/brain/system-prompt');
const prompt = getSystemPrompt('TestUser', 'voice');

console.log('Has [speak] instruction:', prompt.includes('[speak]'));
console.log('Has [silent] instruction:', prompt.includes('[silent]'));
console.log('Has personality:', prompt.includes('## PERSONALITY'));
console.log('Has voice mode header:', prompt.includes('VOICE MODE'));
"
```

---

## 9. End-to-End — Live Run

**What to test:** The full execution pipeline from LLM response to narrated output.

### 9a. Single action

1. Start Venesa: `pnpm start`
2. Say or type: **"open Notepad"**
3. Expected: Notepad opens. Venesa confirms briefly ("Opened Notepad." or similar — no system internals spoken).

### 9b. Multi-step plan

1. Say or type: **"search for readme files and open the first result"**
2. Expected: Venesa executes a `[plan]` with two steps, announces each step per its marker, speaks the final result.
3. In the logs (`logs/` directory), verify a `plan` entry with multiple steps is recorded.

### 9c. Refusal

1. Say or type something completely unsupported: **"hack into NASA"**
2. Expected: Venesa responds with a single structured refusal sentence. No apology. No elaboration. No system internals.

### 9d. Memory adaptation

1. Talk to Venesa a few times in a casual, short-sentence style.
2. Check memory after a few exchanges:

```powershell
node -e "
const memory = require('./src/brain/memory');
console.log('Style:', memory.get('preferences', 'communicationStyle'));
console.log('Adaptations:', memory.get('context', 'personalityAdaptations'));
"
```

Expected: After a few interactions, the LLM should have written a `communicationStyle` value to memory as it detects your pattern.

### 9e. UI rendering

1. Say or type: **"list all my custom commands"**
2. Expected: A `[ui]` block is rendered visually with a table or list. Spoken text is brief ("Here are your commands.").

---

## 10. Capability Validation

**What to test:** A capability file is validated and loaded correctly using the new standard.

```powershell
node -e "
const { validateCapability } = require('./src/skills/validator');
const cap = {
  name: 'testCap',
  description: 'A test capability for validation.',
  version: '1.0.0',
  parameters: require('zod').z.object({ query: require('zod').z.string().describe('The search query') }),
  returnType: 'data',
  marker: 'announce',
  handler: async (params) => ({ result: 'ok' }),
};
const result = validateCapability(cap);
console.log('Valid:', result.valid);
console.log('Errors:', result.errors || 'none');
"
```

---

## Summary Checklist

| Feature | Command | Pass criteria |
|---------|---------|---------------|
| Protocol v2.0 constants | Test 1 | All values present with correct types |
| Execution mode classification | Test 2 | 4 modes correctly detected |
| Pipeline stage tracking | Test 3 | Non-empty array of stage names |
| Refusal detection | Test 4 | `isRefusal: true` for structured refusals only |
| Memory `mutate` API | Test 5 | set/append/remove all work; invalid op is rejected |
| Agent handle state machine | Test 6 | State transitions: PENDING → RUNNING → FAILED/COMPLETED; abort → ABORTED |
| Personality in text prompt | Test 7 | Section present, ordered before execution contract |
| Personality in voice prompt | Test 8 | Section present alongside voice structure |
| End-to-end live run | Test 9 | Actions execute, plans narrate, refusals are clean, memory adapts |
| Capability validation | Test 10 | Valid capability passes; invalid fields are caught |
