const os = require("os");
const path = require("path");
const logger = require("./logger");

function getFallbackPathFor(token) {
  const home = os.homedir();
  const defaultNames = {
    "user.desktop": "Desktop",
    "user.downloads": "Downloads",
    "user.documents": "Documents",
    "user.pictures": "Pictures",
  };
  if (!(token in defaultNames)) {
    logger.warn(`[token-resolver] getFallbackPathFor called with unknown token: ${token}`);
    return home;
  }
  if (process.platform === "win32") {
    try {
      const winShellMap = {
        "user.desktop": "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}",
        "user.downloads": "{374DE290-123F-4565-9164-39C4925E467B}",
        "user.documents": "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}",
        "user.pictures": "{33E28130-4E1E-4676-835A-98395C3BC3BB}",
      };
      const guid = winShellMap[token];
      if (guid) {
        const { execFileSync } = require("child_process");
        const out = execFileSync(
          "reg",
          [
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
            "/v",
            guid,
          ],
          { encoding: "utf8", windowsHide: true },
        );
        const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
        if (m) return m[1].trim().replace(/%USERPROFILE%/gi, home);
      }
    } catch {
      /* fall through */
    }
  }
  return path.join(home, defaultNames[token]);
}

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
        return getFallbackPathFor("user.desktop");
      }
    case "user.downloads":
      try {
        return require("electron").app.getPath("downloads");
      } catch {
        return getFallbackPathFor("user.downloads");
      }
    case "user.documents":
      try {
        return require("electron").app.getPath("documents");
      } catch {
        return getFallbackPathFor("user.documents");
      }
    case "user.pictures":
      try {
        return require("electron").app.getPath("pictures");
      } catch {
        return getFallbackPathFor("user.pictures");
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
          if (
            addr &&
            (addr.family === "IPv4" || addr.family === 4) &&
            !addr.internal
          )
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
          logger.debug(
            `[token-resolver] key-store load/getKeyFromEnv error for key '${key}': ${e.message}`,
          );
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
      ? resolved.length > 4
        ? `***${resolved.slice(-4)}`
        : "****"
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
  if (resolved === "~") {
    resolved = HOME;
  } else if (resolved.startsWith("~/")) {
    resolved = path.join(HOME, resolved.slice(2));
  } else if (!path.isAbsolute(resolved)) {
    resolved = path.join(HOME, resolved);
  }
  return path.normalize(resolved);
}

module.exports = { resolve, resolveString, resolveToken, resolvePath };
