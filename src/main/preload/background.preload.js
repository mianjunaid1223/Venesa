const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backgroundAudioApi', {
    send: (channel, data) => {
        const validChannels = [
            'background-audio-ready',
            'wake-word-detected',
            'get-model-paths',
            'mic-released',
            'resume-failed',
            'console-log',
            'console-error'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        const validChannels = [
            'play-acknowledgment',
            'model-path',
            'pause-detection',
            'resume-detection'
        ];
        if (validChannels.includes(channel)) {
            const handler = (event, ...args) => func(...args);
            ipcRenderer.on(channel, handler);
            return () => ipcRenderer.removeListener(channel, handler);
        }
        return () => { };
    }
});
