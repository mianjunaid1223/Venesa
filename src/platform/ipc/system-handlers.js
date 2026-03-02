/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: IPC System Handlers
 *  Settings save/load, login-item, setup flow.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/llm, platform/speech/stt
 *  USED BY:    platform/main
 * ═══════════════════════════════════════════════════════════════
 */

const { ipcMain, app } = require("electron");
const path = require("path");
const llm = require("../../brain/llm");
const settings = require("../../brain/settings");
const sttService = require("../speech/stt");
const settingsWindow = require("../windows/settings-window");
const logger = require("../../lib/logger");
const memory = require("../../brain/memory");

function register(deps) {
  const {
    getSetupWindow,
    destroySetupWindow,
    createMainWindow,
    startWakeWord,
  } = deps;

  // Setup flow: save API keys provided during onboarding
  ipcMain.on("set-api-keys-setup", async (event, keys) => {
    try {
      const keyStore = require("../../lib/key-store");
      if (keys.gemini) await keyStore.setKey("gemini", keys.gemini);
      if (keys.elevenlabs) await keyStore.setKey("elevenlabs", keys.elevenlabs);
    } catch (e) {
      logger.error(`set-api-keys-setup error: ${e.message}`);
    }
  });

  ipcMain.on("save-settings", async (event, patch) => {
    const success = settings.save(patch);
    if (success) {
      // Re-initialize LLM but don't block main window creation if it fails
      try {
        await llm.initializeAPI();
      } catch (e) {
        logger.error(`Init API failed: ${e.message}`);
      }

      if (patch.openAtLogin !== undefined) {
        app.setLoginItemSettings({
          openAtLogin: patch.openAtLogin,
          path: app.getPath("exe"),
          args: ["--hidden"],
        });
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send("settings-saved", true);
      }

      if (patch.wakeWordEnabled !== undefined) {
        const voiceWin = require("../windows/voice-window");
        const voiceHandlers = require("./voice-handlers");
        let wakeWordAlreadyStarted = false;
        if (patch.wakeWordEnabled) {
          startWakeWord(
            voiceWin.showVoiceWindow,
            voiceHandlers.captureScreenForVoice,
          );
          wakeWordAlreadyStarted = true;
          const bgWin = require("../windows/background-window").getWindow();
          if (bgWin && !bgWin.isDestroyed()) {
            bgWin.webContents.send("resume-detection");          }
        } else {
          const bgWin = require("../windows/background-window").getWindow();
          if (bgWin && !bgWin.isDestroyed()) {
            bgWin.webContents.send("pause-detection");
          }
        }

        const setupWindow = getSetupWindow();
        if (setupWindow && !setupWindow.isDestroyed()) {
          createMainWindow();
          sttService.initialize();
          if (settings.load().wakeWordEnabled && !wakeWordAlreadyStarted) {
            startWakeWord(
              voiceWin.showVoiceWindow,
              voiceHandlers.captureScreenForVoice,
            );
          }
          destroySetupWindow();
        }
      } else {
        const voiceWin2 = require("../windows/voice-window");
        const voiceHandlers2 = require("./voice-handlers");
        const setupWindow = getSetupWindow();
        if (setupWindow && !setupWindow.isDestroyed()) {
          createMainWindow();
          sttService.initialize();
          if (settings.load().wakeWordEnabled) {
            startWakeWord(
              voiceWin2.showVoiceWindow,
              voiceHandlers2.captureScreenForVoice,
            );
          }
          destroySetupWindow();
        }
      }
    } else {
      if (!event.sender.isDestroyed()) {
        event.sender.send("settings-saved", false);
      }
    }
  });

  ipcMain.on("get-settings", (event) => {
    event.sender.send("current-settings", settings.load());
  });

  ipcMain.on("open-settings", (event) => {
    settingsWindow.toggle();
  });

  ipcMain.on("close-settings", (event) => {
    const sw = settingsWindow.get();
    if (sw && !sw.isDestroyed()) {
      sw.close();
    }
  });

  ipcMain.handle("settings:get", async () => {
    return settings.load();
  });

  ipcMain.handle("settings:save", async (event, patch) => {
    const success = settings.save(patch);
    if (success) {
      llm
        .initializeAPI()
        .catch((e) => logger.error(`Init API failed: ${e.message}`));
      // Expire prompt cache so userName changes etc. take effect immediately
      if (llm.invalidatePromptCache) llm.invalidatePromptCache();
      if (patch.wakeWordEnabled !== undefined) {
        const voiceWin = require("../windows/voice-window");
        const voiceHandlers = require("./voice-handlers");
        if (patch.wakeWordEnabled) {
          startWakeWord(
            voiceWin.showVoiceWindow,
            voiceHandlers.captureScreenForVoice,
          );
          const bgWin = require("../windows/background-window").getWindow();
          if (bgWin && !bgWin.isDestroyed()) {
            bgWin.webContents.send("resume-detection");
          }
        } else {
          const bgWin = require("../windows/background-window").getWindow();
          if (bgWin && !bgWin.isDestroyed()) {
            bgWin.webContents.send("pause-detection");
          }
        }
      }
      return true;
    }
    throw new Error("Failed to save settings");
  });

  ipcMain.handle("get-key-status", async () => {
    const keyStore = require("../../lib/key-store");
    return await keyStore.getKeyStatus();
  });

  ipcMain.handle("test-connection", async (event, service, explicitKey) => {
    const keyStore = require("../../lib/key-store");
    // Use explicitly passed key first, fall back to stored primary key
    const key = explicitKey || (await keyStore.getKey(service));
    if (!key) return { success: false, error: "No key saved for this service" };

    try {
      if (service === "gemini") {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        try {
          const signal = AbortSignal.timeout(6000);
          // Pass signal inside requestOptions per GoogleGenerativeAI docs or fallback
          const result = await model.generateContent("Say OK", { signal });
          const text = result?.response?.text();
          return text
            ? { success: true }
            : { success: false, error: "Empty response" };
        } catch (e) {
          if (
            e.name === "AbortError" ||
            (e.message && e.message.includes("timeout"))
          ) {
            return { success: false, error: "Request timed out" };
          }
          throw e;
        }
      } else if (service === "elevenlabs") {
        const { request } = require("undici");
        const resp = await request("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": key },
          signal: AbortSignal.timeout(6000),
        });
        await resp.body.text();
        return resp.statusCode === 200
          ? { success: true }
          : { success: false, error: `Status ${resp.statusCode}` };
      }
      return { success: false, error: `Unknown service: ${service}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("add-api-key", async (event, service, key) => {
    const keyStore = require("../../lib/key-store");
    await keyStore.addKey(service, key);
    const keyPool = require("../../lib/key-pool");
    keyPool.invalidate();
    return true;
  });

  ipcMain.handle("add-custom-key", async (event, envVar, key) => {
    if (!envVar || typeof envVar !== "string")
      throw new Error("Invalid envVar");
    if (!key || typeof key !== "string" || !key.trim())
      throw new Error("Invalid key");

    const keyStore = require("../../lib/key-store");
    // Validate envVar (e.g. OPENWEATHER_KEY)
    const safeEnvVar = envVar
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "");
    if (!safeEnvVar) throw new Error("Invalid envVar after sanitization");

    await keyStore.writeKeyToEnv(safeEnvVar, key.trim());
    const keyPool = require("../../lib/key-pool");
    keyPool.invalidate();
    return true;
  });

  ipcMain.handle("get-api-key", async (event, envVar, svc) => {
    const keyStore = require("../../lib/key-store");
    if (envVar) {
      if (typeof envVar !== "string") return null;
      const safeEnvVar = envVar
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "");
      if (!safeEnvVar) return null;
      return keyStore.getKeyFromEnv(safeEnvVar);
    }
    if (svc) return keyStore.getKey(svc);
    return null;
  });

  // Keep set-api-key for backward compat (setup window uses it)
  ipcMain.handle("set-api-key", async (event, service, key) => {
    const keyStore = require("../../lib/key-store");
    await keyStore.setKey(service, key);
    const keyPool = require("../../lib/key-pool");
    keyPool.invalidate();
    return true;
  });

  // Remove a specific key by its env-var name (e.g. 'GEMINI_API_KEY_2')
  ipcMain.handle("remove-api-key", async (event, envVar) => {
    const keyStore = require("../../lib/key-store");
    await keyStore.removeKeyByEnvVar(envVar);
    const keyPool = require("../../lib/key-pool");
    keyPool.invalidate();
    return true;
  });

  ipcMain.handle("get-loaded-skills", async () => {
    const registry = require("../../skills/registry");
    return registry.getSkillList();
  });

  ipcMain.handle("factory-reset", async () => {
    const fs = require("fs");
    try {
      // 1. Delete settings
      const settingsPath = require("../../brain/settings").SETTINGS_PATH;
      if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);

      // 2. Clear all memory
      const memory = require("../../brain/memory");
      const buckets = memory.BUCKETS || [
        "preferences",
        "history",
        "aliases",
        "context",
      ];
      for (const b of buckets) memory.clear(b);

      // 3. Wipe local capability registry
      try {
        const installer = require("../capability-installer");
        installer.clearLocalRegistry();
      } catch { /* non-critical */ }

      // 4. Invalidate key pool
      require("../../lib/key-pool").invalidate();

      return { success: true };
    } catch (e) {
      logger.error(`Factory reset failed: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // ── Capability management ──────────────────────────────────

  ipcMain.handle("get-capabilities", async () => {
    const registry = require("../../skills/registry");
    return registry.getAllCapabilities ? registry.getAllCapabilities() : [];
  });

  ipcMain.handle("get-builtin-skills", async () => {
    const registry = require("../../skills/registry");
    return registry.getBuiltinSkills
      ? registry.getBuiltinSkills()
      : registry.getSkillList();
  });

  ipcMain.handle("toggle-capability", async (event, capabilityName, enabled) => {
    try {
      const registry = require("../../skills/registry");
      const skill = registry.get(capabilityName);
      if (skill?.lifecycle) {
        const hook = enabled
          ? skill.lifecycle.onEnable
          : skill.lifecycle.onDisable;
        if (typeof hook === "function") {
          try {
            await hook();
          } catch (e) {
            logger.warn(
              `Lifecycle ${enabled ? "onEnable" : "onDisable"} failed for '${capabilityName}': ${e?.message ?? String(e)}`,
            );
          }
        }
      }

      // Migrate legacy pluginStates → capabilityStates on first write
      const legacy = memory.get("aliases", "pluginStates") || {};
      const states = Object.assign({}, legacy, memory.get("aliases", "capabilityStates") || {});
      states[capabilityName] = enabled;
      memory.set("aliases", "capabilityStates", states);
      // Clear migrated legacy key if it existed
      if (Object.keys(legacy).length > 0) memory.set("aliases", "pluginStates", {});

      const loader = require("../../skills/loader");
      loader.reload();
      if (llm.invalidatePromptCache) llm.invalidatePromptCache();
      return { success: true };
    } catch (e) {
      logger.error(`toggle-capability error: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // ── Community capabilities: discovery ─────────────────────

  ipcMain.handle("capabilities:fetch-community", async () => {
    try {
      const installer = require("../capability-installer");
      const list = await installer.fetchCommunityList();
      return { success: true, items: list };
    } catch (e) {
      logger.error(`capabilities:fetch-community error: ${e.message}`);
      return { success: false, error: e.message, items: [] };
    }
  });

  ipcMain.handle("capabilities:fetch-metadata", async (event, rawUrl) => {
    try {
      if (!rawUrl || typeof rawUrl !== "string") {
        return { success: false, error: "Invalid URL" };
      }
      if (!/^https:\/\/(raw\.githubusercontent\.com|gist\.githubusercontent\.com)/i.test(rawUrl)) {
        return {
          success: false,
          error: "Only raw GitHub URLs (raw.githubusercontent.com or gist.githubusercontent.com) are permitted",
        };
      }
      const installer = require("../capability-installer");
      const meta = await installer.fetchMetadata(rawUrl);
      return { success: true, ...meta };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── Community capabilities: install ───────────────────────

  ipcMain.handle("capabilities:install", async (event, rawUrl, registryFileHash) => {
    try {
      if (!rawUrl || typeof rawUrl !== "string") {
        return { success: false, error: "Invalid URL" };
      }
      // Only allow raw GitHub URLs or trusted CDN origins
      if (!/^https:\/\/(raw\.githubusercontent\.com|gist\.githubusercontent\.com)/i.test(rawUrl)) {
        return {
          success: false,
          error: "Only raw GitHub URLs (raw.githubusercontent.com or gist.githubusercontent.com) are permitted",
        };
      }
      const installer = require("../capability-installer");
      const result = await installer.install(rawUrl, registryFileHash || null);
      if (result.success && llm.invalidatePromptCache) {
        llm.invalidatePromptCache();
      }
      return result;
    } catch (e) {
      logger.error(`capabilities:install error: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // ── Community capabilities: uninstall ─────────────────────

  ipcMain.handle("capabilities:uninstall", async (event, capabilityName) => {
    try {
      if (!capabilityName || typeof capabilityName !== "string") {
        return { success: false, error: "Invalid capability name" };
      }
      const installer = require("../capability-installer");
      const result = await installer.uninstall(capabilityName);
      if (result.success && llm.invalidatePromptCache) {
        llm.invalidatePromptCache();
      }
      return result;
    } catch (e) {
      logger.error(`capabilities:uninstall error: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // ── Community capabilities: update ────────────────────────

  ipcMain.handle("capabilities:update", async (event, capabilityName, rawUrl, registryFileHash) => {
    try {
      if (!capabilityName || typeof capabilityName !== "string") {
        return { success: false, error: "Invalid capability name" };
      }
      if (!rawUrl || typeof rawUrl !== "string") {
        return { success: false, error: "Invalid URL" };
      }
      if (!/^https:\/\/(raw\.githubusercontent\.com|gist\.githubusercontent\.com)/i.test(rawUrl)) {
        return {
          success: false,
          error: "Only raw GitHub URLs (raw.githubusercontent.com or gist.githubusercontent.com) are permitted",
        };
      }
      const installer = require("../capability-installer");
      const result = await installer.update(capabilityName, rawUrl, registryFileHash || null);
      if (result.success && llm.invalidatePromptCache) {
        llm.invalidatePromptCache();
      }
      return result;
    } catch (e) {
      logger.error(`capabilities:update error: ${e.message}`);
      return { success: false, error: e.message };
    }
  });
  // ── Community capabilities: local registry (installed versions) ────

  ipcMain.handle("capabilities:get-local-registry", async () => {
    try {
      const installer = require("../capability-installer");
      return { success: true, registry: installer.getLocalRegistry() };
    } catch (e) {
      logger.error(`capabilities:get-local-registry error: ${e.message}`);
      return { success: false, registry: {} };
    }
  });
  // ── Memory IPC ────────────────────────────────────────────

  ipcMain.handle("memory:get-bucket", async (event, bucket) => {
    return memory.get(bucket) || {};
  });

  ipcMain.handle("memory:get-all", async () => {
    const result = {};
    if (Array.isArray(memory.BUCKETS)) {
      for (const bucket of memory.BUCKETS) {
        result[bucket] = memory.get(bucket) || {};
      }
    }
    return result;
  });

  // ── Profile IPC ───────────────────────────────────────────

  ipcMain.handle("profile:get", async () => {
    const s = settings.load();
    return {
      name: s.userName || "",
      bio: s.userBio || "",
    };
  });

  ipcMain.handle("profile:save", async (event, profile) => {
    const patch = {};
    if (profile.name !== undefined) patch.userName = profile.name;
    if (profile.bio !== undefined) patch.userBio = profile.bio;
    settings.save(patch);
    if (llm.invalidatePromptCache) llm.invalidatePromptCache();
    return true;
  });

  ipcMain.handle("memory:clear-bucket", async (event, bucket) => {
    const cleared = memory.clear(bucket);
    if (cleared && llm.invalidatePromptCache) llm.invalidatePromptCache();
    return cleared;
  });

  ipcMain.handle("memory:delete-entry", async (event, bucket, key) => {
    const removed = memory.remove(bucket, key);
    if (removed && llm.invalidatePromptCache) llm.invalidatePromptCache();
    return removed;
  });

  ipcMain.handle("memory:get-custom-commands", async () => {
    return memory.getCustomCommands();
  });

  ipcMain.handle("memory:delete-custom-command", async (event, trigger) => {
    if (!trigger || typeof trigger !== "string")
      return { success: false, error: "Invalid trigger" };
    const result = memory.removeCustomCommand(trigger);
    if (result.success && llm.invalidatePromptCache)
      llm.invalidatePromptCache();
    return result;
  });

  ipcMain.handle("get-about-info", async () => {
    const registry = require("../../skills/registry");
    const cmds = memory.getCustomCommands();
    const capabilities = registry.getAllCapabilities ? registry.getAllCapabilities() : [];
    const skills = registry.getBuiltinSkills
      ? registry.getBuiltinSkills()
      : registry.getSkillList();
    const sett = settings.load();
    return {
      version: "2.0.0",
      electronVersion: process.versions.electron || "-",
      nodeVersion: process.versions.node || "-",
      platform: process.platform,
      arch: process.arch,
      skillCount: Array.isArray(skills) ? skills.length : 0,
      capabilityCount: Array.isArray(capabilities) ? capabilities.length : 0,
      customCommandCount: cmds.length,
      aiModel: sett.modelName || "gemini-2.5-flash-lite",
    };
  });

  // ── Utility ───────────────────────────────────────────────
  ipcMain.handle("open-url", async (event, url) => {
    try {
      const { shell } = require("electron");
      if (url && typeof url === "string" && /^https?:\/\//i.test(url)) {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: "Invalid URL" };
    } catch (e) {
      logger.error(`open-url error: ${e.message}`);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
