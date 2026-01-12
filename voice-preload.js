const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceApi', {
    send: (channel, data) => {
        const validChannels = [
            'voice-query',
            'close-voice-window',
            'voice-window-ready',
            'capture-screen',
            'capture-region',
            'voice-action'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        const validChannels = [
            'start-listening',
            'voice-response',
            'screen-captured',
            'focus-voice',
            'play-sound'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});
