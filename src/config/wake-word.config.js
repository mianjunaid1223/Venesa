/**
 * Wake word detection configuration for Venesa voice assistant
 */

module.exports = {
    phrases: [
        'hey venesa',
        'hey venessa',
        'hey vanessa',
        'hey vanesa',
        'hey venisa',
        'hi venesa',
        'hi venessa'
    ],
    
    confidenceThreshold: 0.6,
    
    minPhraseLength: 3,
    
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
        checkFinalResults: true,
        caseSensitive: false
    },
    
    debounceMs: 1000,
    
    keywords: ['venesa', 'venessa', 'vanessa', 'vanesa', 'venisa'],
    
    debug: {
        logAllRecognition: process.env.DEBUG_LOG_ALL_RECOGNITION === 'true' || process.env.NODE_ENV === 'development',
        logMatches: process.env.DEBUG_LOG_MATCHES === 'true' || process.env.NODE_ENV === 'development',
        logAudioStats: false
    }
};