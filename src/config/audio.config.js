module.exports = {
    SAMPLE_RATE: 16000,
    BUFFER_SIZE: 4096,
    AUDIO_CONSTRAINTS: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 16000
    },
    VAD: {
        silenceThreshold: 0.01,
        minSpeechDuration: 300,
        maxSilenceDuration: 1500
    }
};