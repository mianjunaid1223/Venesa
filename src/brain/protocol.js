/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Protocol
 *  Single source of truth for Venesa's unified execution contract.
 *  Version 2.0 — Governance & Execution Contract compliant.
 *
 *  Governs:
 *    - Return types
 *    - Execution markers
 *    - Execution modes (AI decision outputs)
 *    - UI contract schema
 *    - Memory mutation operations
 *    - Lifecycle hooks
 *    - Workflow pipeline stages
 * ═══════════════════════════════════════════════════════════════
 *  USED BY: skills/validator, skills/registry, skills/loader,
 *           brain/orchestrator, brain/processor
 * ═══════════════════════════════════════════════════════════════
 */

const PROTOCOL_VERSION = '2.0';

// ── Workflow Pipeline Stages ────────────────────────────────
// Every operation must traverse all 7 stages in order.
// No stage may be skipped. No stage may mutate another's responsibility.

const WORKFLOW_STAGES = Object.freeze([
    'INTENT_PARSING',
    'FEASIBILITY_EVALUATION',
    'PLAN_CONSTRUCTION',
    'STEP_EXECUTION',
    'RESULT_STRUCTURING',
    'UI_RENDERING',
    'MEMORY_UPDATE',
]);

// ── AI Decision Contract ────────────────────────────────────
// The LLM emits exactly one of these decisions per resolved intent.
//   EXECUTE             → proceed with action steps
//   REQUEST_CONFIRMATION→ pause, require user approval before executing
//   REFUSE              → task is unsafe, infeasible, or ill-defined
//   RETURN_DATA         → return structured data, no side-effects
//   RETURN_UI           → return renderable UI payload, no side-effects

const AI_DECISIONS = Object.freeze({
    EXECUTE: 'EXECUTE',
    REQUEST_CONFIRMATION: 'REQUEST_CONFIRMATION',
    REFUSE: 'REFUSE',
    RETURN_DATA: 'RETURN_DATA',
    RETURN_UI: 'RETURN_UI',
});

const VALID_AI_DECISIONS = Object.freeze(Object.values(AI_DECISIONS));

// ── Execution Modes ─────────────────────────────────────────
// The mode field in a structured execution contract.

const EXECUTION_MODES = Object.freeze({
    execute: 'execute',
    data: 'data',
    ui: 'ui',
    refuse: 'refuse',
});

const VALID_EXECUTION_MODES = Object.freeze(Object.values(EXECUTION_MODES));

// ── Return Types ────────────────────────────────────────────
// Every capability MUST declare exactly one returnType.
//   data   → fetches information; AI waits for result to reason about
//   action → performs a system mutation or side-effect
//   ui     → returns renderable UI payload
//   memory → reads/writes internal state; never surfaced to user
//   hybrid → combination of two or more types

const RETURN_TYPES = Object.freeze({
    data: 'data',
    action: 'action',
    ui: 'ui',
    memory: 'memory',
    hybrid: 'hybrid',
});

const VALID_RETURN_TYPES = Object.freeze(Object.values(RETURN_TYPES));

// ── Execution Markers ───────────────────────────────────────
// Control user-visible feedback level per step.
//   silently → background; no narration or notification
//   announce → narrate the action as it executes
//   confirm  → pauses execution until user explicitly approves

const EXECUTION_MARKERS = Object.freeze({
    silently: 'silently',
    announce: 'announce',
    confirm: 'confirm',
});

const VALID_MARKERS = Object.freeze(Object.values(EXECUTION_MARKERS));

// ── UI Schema ───────────────────────────────────────────────
// Governs declarative UI payloads emitted by the AI.
// UI is optional and only justified when:
//   a) User intent benefits from interaction
//   b) The action requires user control
//   c) The output is structurally complex

const UI_SCHEMA_TYPES = Object.freeze({
    structured: 'structured',
    interactive: 'interactive',
    custom: 'custom',
});

const VALID_UI_SCHEMA_TYPES = Object.freeze(Object.values(UI_SCHEMA_TYPES));

const UI_MODES = Object.freeze({
    embedded: 'embedded',
    detached: 'detached',
});

const VALID_UI_MODES = Object.freeze(Object.values(UI_MODES));

const CONTROL_TYPES = Object.freeze({
    button: 'button',
    toggle: 'toggle',
    slider: 'slider',
    input: 'input',
});

const VALID_CONTROL_TYPES = Object.freeze(Object.values(CONTROL_TYPES));

// ── UI Components ───────────────────────────────────────────
// Valid values for a capability's `ui` field (structured data hint).
// Separate from [ui] markdown blocks which render free-form content.

const UI_COMPONENTS = Object.freeze([
    'table',
    'key-value',
    'card-list',
    'command-list',
]);

// ── Memory Mutation Operations ──────────────────────────────
// All memory writes must be explicit. No implicit memory mutations.
// Memory mutation contract: { bucket, operation, key, value }

const MEMORY_OPERATIONS = Object.freeze({
    set: 'set',
    append: 'append',
    remove: 'remove',
});

const VALID_MEMORY_OPERATIONS = Object.freeze(Object.values(MEMORY_OPERATIONS));

// ── Lifecycle Hooks ─────────────────────────────────────────
// Optional hooks a capability can implement for lifecycle events.

const LIFECYCLE_HOOKS = Object.freeze([
    'onLoad',
    'onUnload',
    'onEnable',
    'onDisable',
]);

// ── Agent State ─────────────────────────────────────────────
// States for long-running task lifecycle handles.

const AGENT_STATES = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    ABORTED: 'ABORTED',
});

const VALID_AGENT_STATES = Object.values(AGENT_STATES);

module.exports = {
    PROTOCOL_VERSION,
    WORKFLOW_STAGES,
    AI_DECISIONS,
    VALID_AI_DECISIONS,
    EXECUTION_MODES,
    VALID_EXECUTION_MODES,
    RETURN_TYPES,
    VALID_RETURN_TYPES,
    EXECUTION_MARKERS,
    VALID_MARKERS,
    UI_SCHEMA_TYPES,
    VALID_UI_SCHEMA_TYPES,
    UI_MODES,
    VALID_UI_MODES,
    CONTROL_TYPES,
    VALID_CONTROL_TYPES,
    UI_COMPONENTS,
    MEMORY_OPERATIONS,
    VALID_MEMORY_OPERATIONS,
    LIFECYCLE_HOOKS,
    AGENT_STATES,
    VALID_AGENT_STATES,
};

