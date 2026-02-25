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
    clearMemoryBucket: (bucket) => ipcRenderer.invoke('memory:clear-bucket', bucket),
    factoryReset: () => ipcRenderer.invoke('factory-reset'),

    // Window
    close: () => ipcRenderer.send('close-settings'),

    // Events
    receive: (channel, fn) => {
        const allowed = ['settings-saved', 'key-status-update'];
        if (allowed.includes(channel)) {
            ipcRenderer.on(channel, (_, data) => fn(data));
        }
    },
});
