const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backgroundApi', {
    send: (channel, data) => {
        const validChannels = [
            'background-audio-data',
            'background-audio-ready'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        const validChannels = [
            'play-acknowledgment'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});
