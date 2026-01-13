const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceApi', {
    send: (channel, data) => {
        const validChannels = [
            'voice-query',
            'close-voice-window',
            'voice-window-ready',
            'voice-window-closed',
            'auto-close-voice',
            'capture-screen',
            'capture-region',
            'voice-action',
            'audio-data'
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
            'play-sound',
            'stt-result',
            'stt-partial-result',
            'voice-audio-ready'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});
