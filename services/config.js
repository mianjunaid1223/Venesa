/**
 * ElevenLabs Configuration
 * Centralized configuration for ElevenLabs TTS/STT services
 */

require('dotenv').config();

const config = {
    // API Key from .env
    apiKeys: Object.keys(process.env)
        .filter(key => key.startsWith('ELEVENLABS_API_KEY'))
        .sort()
        .map(key => process.env[key])
        .filter(Boolean),

    // Speech-to-Text (STT) Configuration
    stt: {
        model: 'scribe_v1',           // Scribe v1 is the stable HTTP model
        language: 'en',
    },

    // Text-to-Speech (TTS) Configuration  
    tts: {
        model: 'eleven_turbo_v2_5',
        voiceId: 'pFZP5JQG7iQjIQuC4Bku',
        outputFormat: 'mp3_44100_128',
        voiceSettings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
        }
    },

    // API Endpoints
    endpoints: {
        tts: 'https://api.elevenlabs.io/v1/text-to-speech',
        stt: 'https://api.elevenlabs.io/v1/speech-to-text'
    },

    // Validate configuration
    isValid() {
        return this.apiKey && this.apiKey.length > 0 && this.apiKey.startsWith('sk_');
    }
};

module.exports = config;
