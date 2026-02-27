/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Protocol
 *  Single source of truth for Venesa's unified protocol.
 *  Governs return types, execution markers,
 *  lifecycle hooks, and UI component standards.
 * ═══════════════════════════════════════════════════════════════
 *  USED BY: skills/validator, skills/registry, skills/loader,
 *           brain/orchestrator, brain/processor
 * ═══════════════════════════════════════════════════════════════
 */

// ── Return Types ────────────────────────────────────────────
// Every skill/plugin MUST declare exactly one returnType.
// The AI analyzes return types to plan its workflow:
//   data   → fetches information, AI waits for result to reason about
//   action → performs a system mutation or side-effect
//   ui     → returns renderable UI payload
//   memory → suggests context persistence
//   hybrid → combination of above (e.g. data + ui)

const RETURN_TYPES = Object.freeze({
    data: 'data',
    action: 'action',
    ui: 'ui',
    memory: 'memory',
    hybrid: 'hybrid',
});

const VALID_RETURN_TYPES = Object.freeze(Object.values(RETURN_TYPES));

// ── Execution Markers ───────────────────────────────────────
// Control user feedback level during orchestrated plan steps.

const EXECUTION_MARKERS = Object.freeze({
    silently: 'silently',
    announce: 'announce',
    confirm: 'confirm',
});

const VALID_MARKERS = Object.freeze(Object.values(EXECUTION_MARKERS));

// ── UI Components ───────────────────────────────────────────
// Valid values for a skill's `ui` field (structured data rendering).
// Separate from [ui] markdown blocks which render free-form content.

const UI_COMPONENTS = Object.freeze([
    'table',
    'key-value',
    'card-list',
    'command-list',
]);

// ── Lifecycle Hooks ─────────────────────────────────────────
// Optional hooks a plugin can implement for lifecycle events.

const LIFECYCLE_HOOKS = Object.freeze([
    'onLoad',
    'onUnload',
    'onEnable',
    'onDisable',
]);

module.exports = {
    RETURN_TYPES,
    VALID_RETURN_TYPES,
    EXECUTION_MARKERS,
    VALID_MARKERS,
    UI_COMPONENTS,
    LIFECYCLE_HOOKS,
};

