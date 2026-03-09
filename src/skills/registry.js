// Registry — in-memory skill map with metadata for prompt injection and enable/disable state.

const logger = require('../lib/logger');
const { z } = require('zod');
const { VALID_RETURN_TYPES } = require('../brain/protocol');

const skills = new Map();

function register(name, skillModule, source = 'core') {
    if (!name || typeof name !== 'string') {
        throw new Error('Skill name must be a non-empty string');
    }
    if (skills.has(name)) {
        logger.warn(`Skill '${name}' already registered — overwriting`);
    }


    let schema = skillModule.schema;
    let schemaProvided = false;
    if (schema) {
        if (typeof schema.parse !== 'function') {
            throw new Error(`Skill '${name}' provided an invalid schema. Must have a parse() method.`);
        }
        schemaProvided = true;
    } else {
        logger.warn(`Skill '${name}' registered without a schema. Defaulting to z.any().`);
        schema = z.any();
    }


    let returnType = skillModule.returnType || 'action';
    if (VALID_RETURN_TYPES && !VALID_RETURN_TYPES.includes(returnType)) {
        logger.warn(`Skill '${name}' has invalid returnType '${returnType}'. Falling back to 'action'.`);
        returnType = 'action';
    }


    const entry = Object.assign({}, skillModule, {
        _source: source,
        schema,
        _hasSchema: schemaProvided,
        returnType,
    });
    skills.set(name, entry);
    logger.debug(`Registered ${source} skill: ${name} [returnType=${entry.returnType}]`);
}

function get(name) {
    return skills.get(name) || null;
}

function has(name) {
    return skills.has(name);
}

function unregister(name) {
    const skill = skills.get(name);
    if (skill?.lifecycle?.onUnload) {
        try { skill.lifecycle.onUnload(); } catch (e) {
            logger.warn(`Lifecycle onUnload failed for '${name}': ${e.message}`);
        }
    }
    return skills.delete(name);
}

function getAll() {
    return Object.fromEntries(skills);
}

function getAllNames() {
    return [...skills.keys()];
}

function getSkillList() {
    const list = [];
    for (const [name, skill] of skills) {
        list.push({
            name,
            description: skill.description || '',
            version: skill.version || '',
            fileHash: skill.fileHash || null,
            tags: skill.tags || [],
            ui: skill.ui || null,
            source: skill._source || 'core',
            enabled: skill._enabled !== false,
            hasSchema: !!skill._hasSchema,
            returnType: skill.returnType || 'action',
        });
    }
    return list;
}


function getBuiltinSkills() {
    return getSkillList().filter(s => s.source === 'core');
}


function getAllCapabilities() {
    return getSkillList().filter(s => s.source === 'community');
}


function getAllEnabled() {
    const enabledSkills = {};
    for (const [name, skill] of skills) {
        if (skill._enabled === false) continue;
        enabledSkills[name] = skill;
    }
    return enabledSkills;
}


function getByReturnType(type) {
    const results = [];
    for (const [name, skill] of skills) {
        if (skill.returnType === type) results.push({ name, ...skill });
    }
    return results;
}


function getMetadataForPrompt() {
    const enabled = getAllEnabled();
    const entries = Object.entries(enabled);
    if (entries.length === 0) return '';


    const sourceOrder = { internal: 0, core: 1, community: 2 };
    entries.sort((a, b) => (sourceOrder[a[1]._source] ?? 2) - (sourceOrder[b[1]._source] ?? 2));

    const lines = [];
    const examples = [];

    for (const [name, skill] of entries) {

        let paramHint = '';
        if (skill._hasSchema && skill.schema) {
            try {
                const z = require('zod');
                let params = [];
                if (typeof skill.schema.toJSONSchema === 'function') {

                    const jsonSchema = skill.schema.toJSONSchema();
                    if (jsonSchema && jsonSchema.properties) {
                        params = Object.keys(jsonSchema.properties);
                    }
                } else if (typeof z.toJSONSchema === 'function') {

                    const jsonSchema = z.toJSONSchema(skill.schema);
                    if (jsonSchema && jsonSchema.properties) {
                        params = Object.keys(jsonSchema.properties);
                    }
                } else if (skill.schema._def?.shape !== undefined) {

                    const shape = typeof skill.schema._def.shape === 'function'
                        ? skill.schema._def.shape()
                        : skill.schema._def.shape;
                    params = Object.keys(shape || {});
                }
                if (params.length > 0) paramHint = ` | params: ${params.join(', ')}`;
            } catch {  }
        }
        const markerHint = skill.marker ? ` | marker: ${skill.marker}` : '';
        lines.push(`- ${name}: ${skill.description} [${skill.returnType}${markerHint}]${paramHint}`);


        if (Array.isArray(skill.examples)) {
            for (const ex of skill.examples) {
                if (ex.user && ex.action) {
                    examples.push(`- "${ex.user}" -> ${ex.action}`);
                }
            }
        }
    }

    let output = lines.join('\n');

    // Append general execution pattern guidance — no verbatim phrases, no capability-specific examples.
    // The tool listing above already defines what each tool does and what params it accepts.
    output += `

### EXECUTION PATTERNS

Map user intent to the closest available tool and emit the correct syntax. General patterns:

Single tool, no params required:
  [action: toolName]

Single tool with params (only include params the user explicitly mentioned):
  [action: toolName, paramA: value, paramB: value]

Multiple independent operations:
  [plan]
  [step: toolName, marker: announce, paramA: value, label: Brief description of this step]
  [step: toolName2, marker: silently, paramA: value, label: Brief description of this step]
  [/plan]

Step that uses output from a previous step:
  [plan]
  [step: toolA, marker: silently, paramA: value, label: Fetch the data]
  [step: toolB, marker: announce, paramA: $step1.field, label: Use the fetched data]
  [/plan]

searchFiles output format (use $stepN references accordingly):
  { files: [{name, path}, ...], folders: [{name, path}, ...] }
  Example: $step1.files[0].path  or  $step1.folders[0].path

Rules:
- Match tool to intent. If intent is clear, act immediately — never ask for clarification.
- Only add optional params when the user explicitly asked for that behavior.
- Batch operations (same tool, N items) → one [step:] per item inside a [plan].
- Data tools (returnType: data) → result is verbalized by the platform after execution.
- Action tools (returnType: action) → speak what you are about to do, not the outcome.
- When a search returns multiple results, present them to the user and ask which one to open. Do NOT auto-open the first result unless the user explicitly asked for the first one.`;

    return output;
}

function clear() {

    for (const [name, skill] of skills) {
        if (skill?.lifecycle?.onUnload) {
            try { skill.lifecycle.onUnload(); } catch (e) {
                logger.warn(`Lifecycle onUnload failed for '${name}': ${e.message}`);
            }
        }
    }
    skills.clear();
}

module.exports = {
    register,
    get,
    has,
    unregister,
    getAll,
    getAllNames,
    getSkillList,
    getBuiltinSkills,
    getAllCapabilities,

    getAllEnabled,
    getByReturnType,
    getMetadataForPrompt,
    clear,
};
