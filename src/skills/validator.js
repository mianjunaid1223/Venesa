"use strict";

const {
  VALID_RETURN_TYPES,
  VALID_MARKERS,
  UI_COMPONENTS,
  LIFECYCLE_HOOKS,
} = require("../brain/protocol");

const logger = require("../lib/logger");

const IMMEDIATE_EXECUTION_PATTERNS = [
  /^\s*\(function\b/m,
  /^\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>/m,
  /setInterval\s*\(/,
  /setTimeout\s*\(/,
  /process\.exit\s*\(/,
];

function checkSourceForSideEffects(source) {
  const issues = [];
  for (const re of IMMEDIATE_EXECUTION_PATTERNS) {
    if (re.test(source)) {
      issues.push(
        `Source contains potentially unsafe immediate-execution pattern: ${re.toString()}`,
      );
    }
  }
  return issues;
}

function isAsyncFunction(fn) {
  return fn.constructor && fn.constructor.name === "AsyncFunction";
}

function validate(skill, filePath) {
  const errors = [];
  const warnings = [];
  const loc = filePath ? `[${filePath}] ` : "";

  if (!skill || typeof skill !== "object") {
    return {
      valid: false,
      errors: [`${loc}Module does not export an object`],
      warnings: [],
    };
  }

  if (!skill.name || typeof skill.name !== "string") {
    errors.push('Missing or invalid "name" (must be a non-empty string)');
  }

  if (!skill.description || typeof skill.description !== "string") {
    errors.push(
      'Missing or invalid "description" (must be a non-empty string)',
    );
  }

  if (typeof skill.handler !== "function") {
    errors.push('Missing or invalid "handler" (must be a function)');
  } else if (!isAsyncFunction(skill.handler)) {
    warnings.push('"handler" should be async or return a Promise');
  }

  if (!skill.returnType) {
    errors.push(
      'Missing "returnType". Must be one of: ' + VALID_RETURN_TYPES.join(", "),
    );
  } else if (!VALID_RETURN_TYPES.includes(skill.returnType)) {
    errors.push(
      `Invalid "returnType": "${skill.returnType}". Must be one of: ${VALID_RETURN_TYPES.join(", ")}`,
    );
  }

  if (skill.version !== undefined && typeof skill.version !== "string") {
    errors.push('"version" must be a string (e.g. "1.0.0")');
  }

  if (skill.schema !== undefined && typeof skill.schema.parse !== "function") {
    errors.push(
      '"schema" must be a valid Zod schema (must have a parse() method)',
    );
  }

  if (skill.marker && !VALID_MARKERS.includes(skill.marker)) {
    errors.push(
      `Invalid "marker": "${skill.marker}". Must be one of: ${VALID_MARKERS.join(", ")}`,
    );
  }

  if (skill.ui && !UI_COMPONENTS.includes(skill.ui)) {
    errors.push(
      `Invalid "ui": "${skill.ui}". Must be one of: ${UI_COMPONENTS.join(", ")}`,
    );
  }

  if (skill.tags && !Array.isArray(skill.tags)) {
    errors.push('"tags" must be an array');
  }

  if (skill.lifecycle) {
    if (typeof skill.lifecycle !== "object") {
      errors.push('"lifecycle" must be an object');
    } else {
      for (const key of Object.keys(skill.lifecycle)) {
        if (!LIFECYCLE_HOOKS.includes(key)) {
          warnings.push(
            `Unknown lifecycle hook "${key}". Valid hooks: ${LIFECYCLE_HOOKS.join(", ")}`,
          );
        } else if (typeof skill.lifecycle[key] !== "function") {
          errors.push(`Lifecycle hook "${key}" must be a function`);
        }
      }
    }
  }

  if (skill.config !== undefined && (typeof skill.config !== "object" || skill.config === null || Array.isArray(skill.config))) {
    errors.push('"config" must be a plain object');
  }

  if (skill.dependencies !== undefined) {
    if (!Array.isArray(skill.dependencies)) {
      errors.push('"dependencies" must be an array of package specifiers');
    } else {
      const DISALLOWED = /[\^~>=<*]|^git[+:]?:|^https?:|^file:|\.tar\.gz$/i;
      for (const dep of skill.dependencies) {
        if (typeof dep !== "string" || !dep.trim()) {
          errors.push(
            `Invalid dependency entry ${JSON.stringify(dep)}: must be a non-empty string`,
          );
        } else if (DISALLOWED.test(dep)) {
          errors.push(
            `Dependency "${dep}" uses a disallowed format. ` +
              'Only "package" or "package@x.y.z" are accepted.',
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function wrapHandler(skill, filePath) {
  const original = skill.handler;
  const label = skill.name || filePath || "unknown";
  skill.handler = async function isolatedHandler(params, context) {
    try {
      return await original.call(skill, params, context);
    } catch (e) {
      logger.error(
        `[capability:${label}] handler threw: ${e?.message ?? String(e)}`,
      );
      throw e;
    }
  };
  return skill;
}

function _zodTypeName(fieldSchema) {
  if (!fieldSchema || !fieldSchema._def) return null;
  const t = fieldSchema._def.typeName || "";
  if (t === "ZodOptional" || t === "ZodNullable" || t === "ZodDefault") {
    return _zodTypeName(fieldSchema._def.innerType || fieldSchema._def.type);
  }
  if (t === "ZodNumber") return "number";
  if (t === "ZodBoolean") return "boolean";
  if (t === "ZodString") return "string";
  if (t === "ZodNull") return "null";
  if (t === "ZodArray") return "array";
  if (t === "ZodObject") return "object";
  return null;
}

function coerceParams(params, schema) {
  if (!params || typeof params !== "object") return params;
  if (!schema || typeof schema.parse !== "function") return params;

  let fieldTypes;
  try {
    const z = require("zod");
    let jsonSchema = null;
    if (typeof schema.toJSONSchema === "function") {
      jsonSchema = schema.toJSONSchema();
    } else if (typeof z.toJSONSchema === "function") {
      jsonSchema = z.toJSONSchema(schema);
    } else if (schema._def && schema._def.shape !== undefined) {
      const shape =
        typeof schema._def.shape === "function"
          ? schema._def.shape()
          : schema._def.shape;
      fieldTypes = {};
      for (const [key, fieldSchema] of Object.entries(shape || {})) {
        const typeName = _zodTypeName(fieldSchema);
        if (typeName) fieldTypes[key] = typeName;
      }
    }
    if (!fieldTypes && jsonSchema && jsonSchema.properties) {
      fieldTypes = {};
      for (const [key, def] of Object.entries(jsonSchema.properties)) {
        if (def.type) fieldTypes[key] = def.type;
      }
    }
  } catch {}

  if (!fieldTypes) return params;

  const coerced = Object.assign({}, params);
  for (const [key, type] of Object.entries(fieldTypes)) {
    const raw = coerced[key];
    if (typeof raw !== "string") continue;
    try {
      if (type === "number" || type === "integer") {
        if (raw.trim() !== "") {
          const n = Number(raw);
          if (!Number.isNaN(n)) coerced[key] = n;
        }
      } else if (type === "boolean") {
        if (raw === "true") coerced[key] = true;
        else if (raw === "false") coerced[key] = false;
      } else if (type === "null") {
        if (raw === "null") coerced[key] = null;
      }
    } catch {}
  }
  return coerced;
}

module.exports = {
  validate,
  checkSourceForSideEffects,
  wrapHandler,
  coerceParams,
};
