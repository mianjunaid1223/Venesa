/**
 * Background Audio Preload
 * IPC bridge for background audio window
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backgroundAudioApi', {
    send: (channel, data) => {
        const validChannels = [
            'background-audio-ready',
            'background-audio-data',
            'wake-word-detected',
            'get-model-paths',
            'mic-released',
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
            'model-paths',
            'model-buffers',
            'pause-detection',
            'resume-detection'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});
