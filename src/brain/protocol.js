// Protocol — single source of truth for the execution contract (return types, markers, modes, pipeline stages).
const PROTOCOL_VERSION = '2.0';

// Workflow Pipeline Stages

const WORKFLOW_STAGES = Object.freeze([
    'INTENT_PARSING',
    'FEASIBILITY_EVALUATION',
    'PLAN_CONSTRUCTION',
    'STEP_EXECUTION',
    'RESULT_STRUCTURING',
    'UI_RENDERING',
    'MEMORY_UPDATE',
]);

// AI Decision Contract

const AI_DECISIONS = Object.freeze({
    EXECUTE: 'EXECUTE',
    REQUEST_CONFIRMATION: 'REQUEST_CONFIRMATION',
    REFUSE: 'REFUSE',
    RETURN_DATA: 'RETURN_DATA',
    RETURN_UI: 'RETURN_UI',
});

const VALID_AI_DECISIONS = Object.freeze(Object.values(AI_DECISIONS));

// Execution Modes

const EXECUTION_MODES = Object.freeze({
    execute: 'execute',
    data: 'data',
    ui: 'ui',
    refuse: 'refuse',
});

const VALID_EXECUTION_MODES = Object.freeze(Object.values(EXECUTION_MODES));

// Return Types

const RETURN_TYPES = Object.freeze({
    data: 'data',
    action: 'action',
    ui: 'ui',
    memory: 'memory',
    hybrid: 'hybrid',
});

const VALID_RETURN_TYPES = Object.freeze(Object.values(RETURN_TYPES));

// Execution Markers

const EXECUTION_MARKERS = Object.freeze({
    silently: 'silently',
    announce: 'announce',
    confirm: 'confirm',
});

const VALID_MARKERS = Object.freeze(Object.values(EXECUTION_MARKERS));

// UI Components

const UI_COMPONENTS = Object.freeze([
    'table',
    'key-value',
    'card-list',
    'command-list',
]);

// Memory Mutation Operations

const MEMORY_OPERATIONS = Object.freeze({
    set: 'set',
    append: 'append',
    remove: 'remove',
});

const VALID_MEMORY_OPERATIONS = Object.freeze(Object.values(MEMORY_OPERATIONS));

// Lifecycle Hooks

const LIFECYCLE_HOOKS = Object.freeze([
    'onLoad',
    'onUnload',
    'onEnable',
    'onDisable',
]);



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
    UI_COMPONENTS,
    MEMORY_OPERATIONS,
    VALID_MEMORY_OPERATIONS,
    LIFECYCLE_HOOKS,

};

