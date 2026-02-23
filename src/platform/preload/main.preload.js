const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => {
        const validChannels = [
            'send-to-gemini',
            'perform-action',
            'launch-app',
            'open-file',
            'show-file-in-folder',
            'open-folder',
            'resize-window',
            'save-settings',
            'get-settings',
            'open-settings',
            'close-settings',
            'save-ui-state',
            'start-screen-capture',
            'open-external-url',
            'open-voice-window',
            'set-api-keys-setup'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    invoke: (channel, ...args) => {
        const validChannels = ['set-api-key', 'remove-api-key', 'get-key-status'];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
        return Promise.reject(new Error(`Channel '${channel}' not allowed`));
    },
    receive: (channel, func) => {
        const validChannels = [
            'focus-input',
            'gemini-response',
            'action-result',
            'dynamic-ui',
            'settings-saved',
            'current-settings',
            'show-settings-panel',
            'hide-settings-panel',
            'save-state',
            'restore-state',
            'screen-captured',
            'set-input'
        ];
        if (validChannels.includes(channel)) {
            const handler = (event, ...args) => func(...args);
            ipcRenderer.on(channel, handler);

            return () => {
                ipcRenderer.removeListener(channel, handler);
            };
        }
        return () => { };
    }
});
