/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Skill Registry
 *  Map of skillName → skill object. Skills register via loader.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, brain/protocol
 *  USED BY:    brain/orchestrator, brain/processor, skills/loader,
 *              brain/system-prompt
 * ═══════════════════════════════════════════════════════════════
 */

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

    // Validate schema if it exists, otherwise provide a default empty schema
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

    // Validate and assign returnType
    let returnType = skillModule.returnType || 'action';
    if (VALID_RETURN_TYPES && !VALID_RETURN_TYPES.includes(returnType)) {
        logger.warn(`Skill '${name}' has invalid returnType '${returnType}'. Falling back to 'action'.`);
        returnType = 'action';
    }

    // Build the registry entry with protocol-compliant metadata
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

/** Returns only built-in core skills */
function getBuiltinSkills() {
    return getSkillList().filter(s => s.source === 'core');
}

/** Returns only external plugin skills */
function getAllPlugins() {
    return getSkillList().filter(s => s.source === 'plugin');
}

/** Returns only enabled skills */
function getAllEnabled() {
    const enabledSkills = {};
    for (const [name, skill] of skills) {
        if (skill._enabled === false) continue;
        enabledSkills[name] = skill;
    }
    return enabledSkills;
}

/** Query skills by returnType */
function getByReturnType(type) {
    const results = [];
    for (const [name, skill] of skills) {
        if (skill.returnType === type) results.push({ name, ...skill });
    }
    return results;
}

/**
 * Generate minimal skill metadata for system prompt injection.
 * Replaces hard-coded skill lists in system-prompt.js.
 * Returns a formatted string the AI can read as its tool manifest.
 */
function getMetadataForPrompt() {
    const enabled = getAllEnabled();
    const entries = Object.entries(enabled);
    if (entries.length === 0) return '';

    const lines = entries.map(([name, skill]) => {
        // Build param hint from Zod schema if available
        let paramHint = '';
        if (skill._hasSchema && skill.schema?._def?.shape) {
            try {
                const shape = skill.schema._def.shape();
                const params = Object.keys(shape).join(', ');
                if (params) paramHint = ` | params: ${params}`;
            } catch { /* ignore schema introspection failures */ }
        }
        return `- ${name}: ${skill.description} [${skill.returnType}]${paramHint}`;
    });

    return lines.join('\n');
}

function clear() {
    // Call onUnload for all skills before clearing
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
    getAllPlugins,
    getAllEnabled,
    getByReturnType,
    getMetadataForPrompt,
    clear,
};
