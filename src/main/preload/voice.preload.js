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
            'audio-data',
            'voice-audio',
            'open-file',
            'open-folder',
            'launch-app',
            'restart-stt',
            'voice-file-action'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        const validChannels = [
            'start-listening',
            'stop-listening',
            'continue-listening',
            'voice-response',
            'voice-search-results',
            'screen-captured',
            'focus-voice',
            'play-sound',
            'stt-result',
            'stt-partial-result',
            'voice-audio-ready',
            'auto-close-voice',
            'action-complete'
        ];
        if (validChannels.includes(channel)) {

            if (typeof func !== 'function') {
                console.warn(`[VoicePreload] receive: callback for '${channel}' is not a function`);
                return () => { };
            }
            const handler = (event, ...args) => func(...args);
            ipcRenderer.on(channel, handler);
            return () => {
                ipcRenderer.removeListener(channel, handler);
            };
        }
        return () => { };
    }
});
