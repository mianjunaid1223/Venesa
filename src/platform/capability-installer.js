"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const logger = require("../lib/logger");
const { validate, checkSourceForSideEffects } = require("../skills/validator");
const depManager = require("./dep-manager");

const ALLOWED_HOSTNAMES = [
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
];

function getCapDir() {
  return require("../lib/paths").getCapabilitiesPath();
}

function getTmpDir() {
  const dir = path.join(__dirname, "..", "..", ".cap-tmp");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return dir;
}

function download(url, maxRedirects = 5, timeoutMs = 10000, allowedHosts = null) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error("Too many redirects"));
    }
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      { headers: { "User-Agent": "Venesa/2.0" } },
      (res) => {
        clearTimeout(timer);
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (allowedHosts) {
            let redirectHostname;
            try {
              redirectHostname = new URL(location).hostname;
            } catch {
              return reject(new Error(`Invalid redirect URL: ${location}`));
            }
            if (!allowedHosts.includes(redirectHostname)) {
              return reject(
                new Error(
                  `Disallowed redirect hostname: ${redirectHostname}`,
                ),
              );
            }
          }
          return download(
            location,
            maxRedirects - 1,
            timeoutMs,
            allowedHosts,
          ).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      },
    );
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

async function fetchCommunityList() {
  const registryUrl =
    "https://raw.githubusercontent.com/mianjunaid1223/venesa-capabilities/main/registry.json";
  const body = await download(registryUrl);
  let registry;
  try {
    registry = JSON.parse(body);
  } catch {
    throw new Error("Failed to parse registry.json");
  }

  if (!registry || !Array.isArray(registry.capabilities)) {
    throw new Error("Unexpected registry.json format");
  }

  return registry.capabilities.map((item) => ({
    name: item.name,
    description: item.description || "",
    version: item.version || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    returnType: item.returnType || "",
    ui: item.ui || null,
    marker: item.marker || "",
    file: item.file || "",
    download_url: item.url || "",
    fileHash: item.hash || item.fileHash || "",
  }));
}

async function fetchMetadata(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Untrusted URL origin: URL could not be parsed");
  }
  if (!ALLOWED_HOSTNAMES.includes(parsedUrl.hostname)) {
    throw new Error(
      `Untrusted URL origin: only ${ALLOWED_HOSTNAMES.join(" and ")} are permitted`,
    );
  }

  const source = await download(rawUrl, 5, 10000, ALLOWED_HOSTNAMES);

  const sideEffects = checkSourceForSideEffects(source, rawUrl);
  if (sideEffects.length > 0) {
    throw new Error(`Source safety check failed: ${sideEffects.join("; ")}`);
  }

  const tmpFile = path.join(getTmpDir(), `venesa-cap-meta-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, source, "utf8");

  let exported;
  try {
    const resolved = require.resolve(tmpFile);
    delete require.cache[resolved];
    exported = require(tmpFile);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    try {
      delete require.cache[require.resolve(tmpFile)];
    } catch {}
  }

  return {
    name: exported.name || "(unknown)",
    description: exported.description || "",
    version: exported.version || "",
  };
}

async function install(rawUrl, registryFileHash) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { success: false, error: "Invalid URL provided" };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return {
      success: false,
      error: "Untrusted URL origin: URL could not be parsed",
    };
  }
  if (!ALLOWED_HOSTNAMES.includes(parsedUrl.hostname)) {
    return {
      success: false,
      error: `Untrusted URL origin: only ${ALLOWED_HOSTNAMES.join(" and ")} are permitted`,
    };
  }

  let source;
  try {
    source = await download(rawUrl, 5, 10000, ALLOWED_HOSTNAMES);
  } catch (e) {
    logger.error(`[capability-installer] Download failed: ${e.message}`);
    return { success: false, error: `Download failed: ${e.message}` };
  }

  const sideEffects = checkSourceForSideEffects(source);
  if (sideEffects.length > 0) {
    logger.warn(
      `[capability-installer] Source safety check failed: ${sideEffects.join("; ")}`,
    );
    return {
      success: false,
      error: `Source safety check failed: ${sideEffects.join("; ")}`,
    };
  }

  const tmpFile = path.join(getTmpDir(), `venesa-cap-install-${Date.now()}.js`);
  let exported;
  try {
    fs.writeFileSync(tmpFile, source, "utf8");
    const resolved = require.resolve(tmpFile);
    delete require.cache[resolved];
    exported = require(tmpFile);
  } catch (e) {
    logger.error(
      `[capability-installer] Failed to load capability source: ${e.message}`,
    );
    return { success: false, error: `Source evaluation failed: ${e.message}` };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    try {
      delete require.cache[require.resolve(tmpFile)];
    } catch {}
  }

  const result = validate(exported, rawUrl);
  if (!result.valid) {
    logger.warn(
      `[capability-installer] Validation failed for ${rawUrl}: ${result.errors.join(", ")}`,
    );
    return {
      success: false,
      error: `Validation failed: ${result.errors.join("; ")}`,
    };
  }

  const capName = exported.name;

  const installedSource = source;

  const capDir = getCapDir();
  try {
    if (!fs.existsSync(capDir)) {
      fs.mkdirSync(capDir, { recursive: true });
    }
  } catch (e) {
    return {
      success: false,
      error: `Cannot create capabilities directory: ${e.message}`,
    };
  }

  const fileName = sanitizeFileName(capName) + ".js";
  const destPath = path.join(capDir, fileName);
  try {
    fs.writeFileSync(destPath, installedSource, "utf8");
  } catch (e) {
    logger.error(`[capability-installer] Write failed: ${e.message}`);
    return { success: false, error: `Write failed: ${e.message}` };
  }

  logger.info(
    `[capability-installer] Installed capability '${capName}' → ${destPath}`,
  );

  // ── Dep engine: install capability-declared dependencies ────
  if (Array.isArray(exported.dependencies) && exported.dependencies.length > 0) {
    const depResult = await depManager.installDepsForCapability(capName, exported.dependencies);
    if (depResult.corrupted) {
      const memory = require('../brain/memory');
      memory.markCorrupted(capName, depResult.reason);
      logger.error(`[capability-installer] Corrupted '${capName}': ${depResult.reason}`);
      return { success: false, error: depResult.reason };
    }
  }
  try {
    const memory = require('../brain/memory');
    memory.clearCorrupted(capName);
  } catch { /* non-critical */ }

  // Persist file hash for update detection
  if (registryFileHash) {
    const reg = readLocalRegistry();
    reg[capName] = { fileHash: registryFileHash, version: exported.version || null, installedAt: new Date().toISOString() };
    writeLocalRegistry(reg);
  }
  // Persist enabled-by-default state to memory on first install.
  try {
    const memory = require('../brain/memory');
    const states = memory.get('aliases', 'capabilityStates') || {};
    if (!(capName in states)) {
      states[capName] = true;
      memory.set('aliases', 'capabilityStates', states);
    }
  } catch { /* non-critical */ }
  try {
    const loader = require("../skills/loader");
    loader.reload();
  } catch (e) {
    logger.warn(
      `[capability-installer] Reload after install failed: ${e.message}`,
    );
  }

  return { success: true, name: capName };
}

async function update(capabilityName, rawUrl, registryFileHash) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { success: false, error: "Invalid URL provided" };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return {
      success: false,
      error: "Untrusted URL origin: URL could not be parsed",
    };
  }
  if (!ALLOWED_HOSTNAMES.includes(parsedUrl.hostname)) {
    return {
      success: false,
      error: `Untrusted URL origin: only ${ALLOWED_HOSTNAMES.join(" and ")} are permitted`,
    };
  }

  let source;
  try {
    source = await download(rawUrl, 5, 10000, ALLOWED_HOSTNAMES);
  } catch (e) {
    logger.error(`[capability-installer] Update download failed: ${e.message}`);
    return { success: false, error: `Download failed: ${e.message}` };
  }

  const sideEffects = checkSourceForSideEffects(source);
  if (sideEffects.length > 0) {
    return {
      success: false,
      error: `Source safety check failed: ${sideEffects.join("; ")}`,
    };
  }

  const tmpFile = path.join(getTmpDir(), `venesa-cap-update-${Date.now()}.js`);
  let exported;
  try {
    fs.writeFileSync(tmpFile, source, "utf8");
    const resolved = require.resolve(tmpFile);
    delete require.cache[resolved];
    exported = require(tmpFile);
  } catch (e) {
    logger.error(
      `[capability-installer] Update source evaluation failed: ${e.message}`,
    );
    return { success: false, error: `Source evaluation failed: ${e.message}` };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    try {
      delete require.cache[require.resolve(tmpFile)];
    } catch {}
  }

  const result = validate(exported, rawUrl);
  if (!result.valid) {
    return {
      success: false,
      error: `Validation failed: ${result.errors.join("; ")}`,
    };
  }

  if (exported.name !== capabilityName) {
    return {
      success: false,
      error: `Capability name mismatch: expected "${capabilityName}", got "${exported.name}"`,
    };
  }

  const capName = exported.name;
  const capDir = getCapDir();
  const fileName = sanitizeFileName(capName) + ".js";
  const destPath = path.join(capDir, fileName);

  try {
    if (!fs.existsSync(capDir)) {
      fs.mkdirSync(capDir, { recursive: true });
    }
    fs.writeFileSync(destPath, source, "utf8");
  } catch (e) {
    logger.error(`[capability-installer] Update write failed: ${e.message}`);
    return { success: false, error: `Write failed: ${e.message}` };
  }

  logger.info(
    `[capability-installer] Updated capability '${capName}' → ${destPath}`,
  );

  // ── Dep engine: reinstall capability-declared dependencies ──
  if (Array.isArray(exported.dependencies) && exported.dependencies.length > 0) {
    const depResult = await depManager.installDepsForCapability(capName, exported.dependencies);
    if (depResult.corrupted) {
      const memory = require('../brain/memory');
      memory.markCorrupted(capName, depResult.reason);
      logger.error(`[capability-installer] Corrupted '${capName}' after update: ${depResult.reason}`);
      return { success: false, error: depResult.reason };
    }
  }
  try {
    const memory = require('../brain/memory');
    memory.clearCorrupted(capName);
  } catch { /* non-critical */ }

  // Persist updated file hash
  if (registryFileHash) {
    const reg = readLocalRegistry();
    reg[capName] = { fileHash: registryFileHash, version: exported.version || null, installedAt: new Date().toISOString() };
    writeLocalRegistry(reg);
  }

  try {
    const loader = require("../skills/loader");
    loader.reload();
  } catch (e) {
    logger.warn(
      `[capability-installer] Reload after update failed: ${e.message}`,
    );
  }

  return { success: true, name: capName };
}

async function uninstall(capabilityName) {
  if (!capabilityName || typeof capabilityName !== "string") {
    return { success: false, error: "Invalid capability name" };
  }

  try {
    const registry = require("../skills/registry");
    const skill = registry.get(capabilityName);
    if (skill && (skill._source === "core" || skill._source === "internal")) {
      return {
        success: false,
        error: "Core capabilities cannot be uninstalled",
      };
    }
  } catch (e) {
    logger.error(
      `[capability-installer] Unable to verify capability source: ${e?.message ?? e}`,
    );
    return { success: false, error: "Unable to verify capability source" };
  }

  const capDir = getCapDir();
  const fileName = sanitizeFileName(capabilityName) + ".js";
  const filePath = path.join(capDir, fileName);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Capability file not found: ${fileName}` };
  }

  try {
    fs.unlinkSync(filePath);

    try {
      delete require.cache[require.resolve(filePath)];
    } catch {}
  } catch (e) {
    logger.error(`[capability-installer] Uninstall failed: ${e.message}`);
    return { success: false, error: e.message };
  }

  logger.info(
    `[capability-installer] Uninstalled capability '${capabilityName}'`,
  );
  // Remove from local registry
  try {
    const reg = readLocalRegistry();
    if (reg[capabilityName]) {
      delete reg[capabilityName];
      writeLocalRegistry(reg);
    }
  } catch (err) {
    logger.error(
      `[capability-installer] Failed to update local registry while removing '${capabilityName}': ${err.message}`,
    );
  }

  // ── Dep engine: remove isolated node_modules + manifests ────
  try {
    await depManager.removeDepsForCapability(capabilityName);
  } catch (depErr) {
    logger.error(
      `[capability-installer] removeDepsForCapability failed for '${capabilityName}': ${depErr.message}`,
    );
  }
  try {
    const memory = require('../brain/memory');
    memory.clearCorrupted(capabilityName);
  } catch { /* non-critical */ }

  // Remove persisted enabled/disabled state so reinstalling starts fresh
  try {
    const memory = require("../brain/memory");
    const states = Object.assign(
      {},
      memory.get("aliases", "capabilityStates") || {},
    );
    delete states[capabilityName];
    memory.set("aliases", "capabilityStates", states);
  } catch (e) {
    logger.warn(
      `[capability-installer] Failed to clear capability state: ${e.message}`,
    );
  }

  try {
    const loader = require("../skills/loader");
    loader.reload();
  } catch (e) {
    logger.warn(
      `[capability-installer] Reload after uninstall failed: ${e.message}`,
    );
  }

  return { success: true };
}

// ── Local registry (persists installed file hashes) ─────────────────────────

function getLocalRegistryPath() {
  return path.join(getCapDir(), ".local-registry.json");
}

function readLocalRegistry() {
  const p = getLocalRegistryPath();
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch (err) {
    logger.error(
      `[capability-installer] Failed to parse local registry at '${p}': ${err.message}`,
    );
    try {
      const backup = `${p}.corrupt.${Date.now()}`;
      fs.renameSync(p, backup);
      logger.warn(
        `[capability-installer] Corrupted registry backed up to '${backup}'`,
      );
    } catch (backupErr) {
      logger.error(
        `[capability-installer] Could not back up corrupted registry '${p}': ${backupErr.message}`,
      );
    }
  }
  return {};
}

function writeLocalRegistry(reg) {
  try {
    const capDir = getCapDir();
    if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(getLocalRegistryPath(), JSON.stringify(reg, null, 2), "utf8");
  } catch (e) {
    logger.warn(`[capability-installer] Could not write local registry: ${e.message}`);
  }
}

function getLocalRegistry() {
  return readLocalRegistry();
}

function sanitizeFileName(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();
}

function injectDisabledFlag(source, name) {
  const header = [``, ``, ``, ""].join("\n");

  if (!/\benabled\s*:/.test(source)) {
    const suffix = [
      "",
      "// Venesa: capability disabled by default after installation",
      ";(function(){",
      "  const _m = module.exports;",
      '  if (_m && typeof _m === "object") _m.enabled = false;',
      "})();",
    ].join("\n");
    return header + source + suffix;
  }
  return header + source;
}

module.exports = {
  install,
  update,
  uninstall,
  fetchCommunityList,
  fetchMetadata,
  getLocalRegistry,
};
