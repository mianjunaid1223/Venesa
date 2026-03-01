/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Settings Preload
 *  Context bridge for the settings window.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: electron
 *  USED BY:    renderer/settings.window.html
 * ═══════════════════════════════════════════════════════════════
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
    // Settings
    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

    // API Keys
    getKeyStatus: () => ipcRenderer.invoke('get-key-status'),
    testConnection: (service, key) => ipcRenderer.invoke('test-connection', service, key),
    addApiKey: (service, key) => ipcRenderer.invoke('add-api-key', service, key),
    setApiKey: (service, key) => ipcRenderer.invoke('set-api-key', service, key),
    removeApiKey: (envVar) => ipcRenderer.invoke('remove-api-key', envVar),

    // Skills
    getLoadedSkills: () => ipcRenderer.invoke('get-loaded-skills'),

    // Memory
    getMemoryBucket: (bucket) => ipcRenderer.invoke('memory:get-bucket', bucket),
    getAllMemory: () => ipcRenderer.invoke('memory:get-all'),
    clearMemoryBucket: (bucket) => ipcRenderer.invoke('memory:clear-bucket', bucket),
    removeMemoryEntry: (bucket, key) => ipcRenderer.invoke('memory:delete-entry', bucket, key),
    getCustomCommands: () => ipcRenderer.invoke('memory:get-custom-commands'),
    deleteCustomCommand: (trigger) => ipcRenderer.invoke('memory:delete-custom-command', trigger),
    factoryReset: () => ipcRenderer.invoke('factory-reset'),

    // About info
    getAboutInfo: () => ipcRenderer.invoke('get-about-info'),

    // Profile
    getProfile: () => ipcRenderer.invoke('profile:get'),
    saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),

    // Window
    close: () => ipcRenderer.send('close-settings'),
    openUrl: (url) => {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
            return Promise.reject(new Error('Invalid URL protocol'));
        }
        return ipcRenderer.invoke('open-url', url);
    },

    // API Keys (Extra)
    addCustomKey: (envVar, key) => ipcRenderer.invoke('add-custom-key', envVar, key),
    getApiKey: (envVar, svc) => ipcRenderer.invoke('get-api-key', envVar, svc),

    // Plugins
    getPlugins: () => ipcRenderer.invoke('get-plugins'),
    getBuiltinSkills: () => ipcRenderer.invoke('get-builtin-skills'),
    togglePlugin: (name, enabled) => ipcRenderer.invoke('toggle-plugin', name, enabled),

    // Runtime versions (contextBridge safe)
    versions: {
        electron: process.versions.electron || '-',
        node: process.versions.node || '-',
        chrome: process.versions.chrome || '-',
    },

    // Events
    receive: (channel, fn) => {
        const allowed = ['settings-saved', 'key-status-update'];
        if (!allowed.includes(channel)) {
            return () => {}; // no-op unsubscribe for disallowed channels
        }
        const wrapper = (_, data) => fn(data);
        ipcRenderer.on(channel, wrapper);
        return () => ipcRenderer.removeListener(channel, wrapper);
    },
});
