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
            'restart-stt'
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
            'voice-audio-ready'
        ];
        if (validChannels.includes(channel)) {
            // Verify func is a function before registering
            if (typeof func !== 'function') {
                console.warn(`[VoicePreload] receive: callback for '${channel}' is not a function`);
                return () => { };
            }
            const handler = (event, ...args) => func(...args);
            ipcRenderer.on(channel, handler);
            // Return unsubscribe function
            return () => {
                ipcRenderer.removeListener(channel, handler);
            };
        }
        return () => { }; // Return no-op if invalid channel
    }
});
