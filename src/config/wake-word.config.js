

module.exports = {




    audio: {
        sampleRate: 16000,
        channels: 1,
        bufferSize: 4096
    },

    model: {
        path: './models/vosk-model.tar.gz',
        language: 'en-us',
        sampleRate: 16000
    },

    behavior: {
        cooldownMs: 1000,
        checkPartialResults: true,
        checkFinalResults: true
    },

    debounceMs: 1000
};
