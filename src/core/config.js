/**
 * ElevenLabs Configuration
 */

require('dotenv').config();

const config = {
    apiKeys: Object.keys(process.env)
        .filter(key => key.startsWith('ELEVENLABS_API_KEY'))
        .sort()
        .map(key => process.env[key])
        .filter(Boolean),

    stt: {
        model: 'scribe_v1',
        language: 'en'
    },

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

    endpoints: {
        tts: 'https://api.elevenlabs.io/v1/text-to-speech',
        stt: 'https://api.elevenlabs.io/v1/speech-to-text'
    },

    isValid() {
        return this.apiKeys && this.apiKeys.length > 0;
    }
};

module.exports = config;
