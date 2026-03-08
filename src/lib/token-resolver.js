const os = require("os");
const path = require("path");
const logger = require("./logger");

const TOKEN_PATTERN = /\{\{([^}]+)\}\}/g;
const HOME = os.homedir();

function resolveToken(name) {
  const now = new Date();
  switch (name) {
    case "system.time":
      return now.toLocaleTimeString();
    case "system.date":
      return now.toLocaleDateString();
    case "system.os":
      return process.platform;
    case "system.arch":
      return process.arch;
    case "system.hostname":
      return os.hostname();
    case "user.name": {
      try {
        const settings = require("../brain/settings");
        const s = settings.load();
        return s.userName && s.userName !== "User"
          ? s.userName
          : os.userInfo().username;
      } catch {
        return os.userInfo().username;
      }
    }
    case "user.home":
      try {
        return require("electron").app.getPath("home");
      } catch {
        return HOME;
      }
    case "user.desktop":
      try {
        return require("electron").app.getPath("desktop");
      } catch {
        return path.join(HOME, "Desktop");
      }
    case "user.downloads":
      try {
        return require("electron").app.getPath("downloads");
      } catch {
        return path.join(HOME, "Downloads");
      }
    case "user.documents":
      try {
        return require("electron").app.getPath("documents");
      } catch {
        return path.join(HOME, "Documents");
      }
    case "user.pictures":
      try {
        return require("electron").app.getPath("pictures");
      } catch {
        return path.join(HOME, "Pictures");
      }
    case "runtime.cwd":
      return process.cwd();
    case "runtime.temp":
      return os.tmpdir();
    case "runtime.session_id":
      return global.__venesa_session_id || "unknown";
    case "clipboard.text":
      try {
        return require("electron").clipboard.readText() || "";
      } catch {
        return "";
      }
    case "network.ip": {
      const ifaces = os.networkInterfaces() || {};
      for (const iface of Object.values(ifaces)) {
        if (!iface) continue;
        for (const addr of iface) {
          if (addr && addr.family === "IPv4" && !addr.internal)
            return addr.address;
        }
      }
      return "127.0.0.1";
    }
    case "network.hostname":
      return os.hostname();
    default:
      if (name.startsWith("env.")) {
        const key = name.slice(4);
        if (process.env[key] !== undefined) return process.env[key];
        try {
          const keyStore = require("./key-store");
          const stored = keyStore.getKeyFromEnv(key);
          if (stored !== null && stored !== undefined) return stored;
        } catch (e) {
          logger.debug(`[token-resolver] key-store load/getKeyFromEnv error for key '${key}': ${e.message}`);
        }
        const err = new Error(
          `Missing environment variable '${key}'. Add it in Settings → Custom Keys.`,
        );
        err.code = "ENV_NOT_SET";
        err.envKey = key;
        throw err;
      }
      return null;
  }
}

function resolveString(value) {
  if (typeof value !== "string") return value;
  if (!value.includes("{{")) return value;
  return value.replace(TOKEN_PATTERN, (match, tokenName) => {
    const trimmed = tokenName.trim();
    const resolved = resolveToken(trimmed);
    if (resolved === null) {
      logger.warn(`[token-resolver] Unknown token: {{${trimmed}}}`);
      throw new Error(`Unknown token: {{${trimmed}}}`);
    }
    const isSensitive = /^env\./.test(trimmed);
    const displayValue = isSensitive
      ? resolved.length > 4 ? `***${resolved.slice(-4)}` : "****"
      : resolved;
    logger.debug(`[token-resolver] {{${trimmed}}} -> ${displayValue}`);
    return resolved;
  });
}

function resolve(params) {
  if (!params || typeof params !== "object") return params;
  const result = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = typeof value === "string" ? resolveString(value) : value;
  }
  return result;
}

function resolvePath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return rawPath;
  let resolved = resolveString(rawPath);
  if (resolved.startsWith("~/") || resolved === "~") {
    resolved = path.join(HOME, resolved.slice(1));
  } else if (!path.isAbsolute(resolved)) {
    resolved = path.join(HOME, resolved);
  }
  return path.normalize(resolved);
}

module.exports = { resolve, resolveString, resolveToken, resolvePath };
