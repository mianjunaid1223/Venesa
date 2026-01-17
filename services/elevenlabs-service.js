/**
 * ElevenLabs Service
 * Unified TTS/STT service with minimal latency for voice assistant
 */

const config = require('./config.js');
const keyPool = require('../src/shared/elevenLabsKeyPool');

// Initialize the key pool
keyPool.initialize();

/**
 * Convert PCM buffer to WAV format for ElevenLabs API
 * @param {Buffer} pcmBuffer - Raw PCM audio (16-bit, 16kHz, mono)
 * @returns {Buffer} WAV formatted buffer
 */
function pcmToWav(pcmBuffer) {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;

    // WAV header is 44 bytes
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([header, pcmBuffer]);
}

/**
 * Transcribe audio using ElevenLabs Scribe STT with key rotation
 * @param {Buffer} audioBuffer - Audio buffer (WAV, WebM, etc.)
 * @param {Object} options - Optional parameters
 * @param {string} options.filename - Filename for the upload (default: audio.wav)
 * @param {string} options.contentType - MIME type (default: audio/wav)
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(audioBuffer, options = {}) {
    if (!keyPool.isHealthy()) {
        keyPool.initialize();
        if (!keyPool.isHealthy()) {
            throw new Error('No valid ElevenLabs API keys available');
        }
    }

    const {
        filename = 'audio.wav',
        contentType = 'audio/wav'
    } = options;

    const FormData = require('form-data');
    const maxRetries = keyPool.getAvailableKeyCount();
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const apiKey = keyPool.getNextKey();
        if (!apiKey) break;

        try {
            const form = new FormData();
            form.append('file', audioBuffer, {
                filename: filename,
                contentType: contentType
            });
            form.append('model_id', config.stt.model);

            const formHeaders = form.getHeaders();

            const response = await fetch(config.endpoints.stt, {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    ...formHeaders
                },
                body: form.getBuffer()
            });

            if (!response.ok) {
                const errorText = await response.text();
                // Create an error object compatible with keyPool.reportError
                const error = new Error(`STT failed: ${response.status} - ${errorText}`);
                error.status = response.status;
                error.message = errorText;
                throw error;
            }

            const result = await response.json();

            // Report success
            keyPool.reportSuccess(apiKey);

            return result.text || '';
        } catch (error) {
            lastError = error;
            console.error(`[ElevenLabs] STT Error with key ending in ...${apiKey.slice(-4)}: ${error.message}`);

            const errorResult = keyPool.reportError(apiKey, error);

            // If the error wasn't handled by the pool (e.g. not a rate limit or auth error),
            // and it's not a network error, we might consider stopping.
            // But for robustness in this user request context, we continue retrying.
            if (!errorResult.keyHandled && error.status !== 401 && error.status !== 429) {
                // optionally break here
            }
        }
    }

    throw lastError || new Error('ElevenLabs STT failed with all available keys');
}

/**
 * Synthesize speech and return as base64 data URL with key rotation
 * @param {string} text - Text to synthesize
 * @returns {Promise<string>} Audio data URL (base64)
 */
async function synthesizeToDataURL(text) {
    if (!keyPool.isHealthy()) {
        keyPool.initialize();
        if (!keyPool.isHealthy()) {
            throw new Error('No valid ElevenLabs API keys available');
        }
    }

    if (!text || text.trim().length === 0) {
        return null;
    }

    const maxRetries = keyPool.getAvailableKeyCount();
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const apiKey = keyPool.getNextKey();
        if (!apiKey) break;

        try {
            const response = await fetch(
                `${config.endpoints.tts}/${config.tts.voiceId}?output_format=${config.tts.outputFormat}`,
                {
                    method: 'POST',
                    headers: {
                        'xi-api-key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: text,
                        model_id: config.tts.model,
                        voice_settings: config.tts.voiceSettings
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(`TTS failed: ${response.status} - ${errorText}`);
                error.status = response.status;
                error.message = errorText;
                throw error;
            }

            // Get audio as array buffer
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Report success
            keyPool.reportSuccess(apiKey);

            // Convert to base64 data URL
            const base64 = buffer.toString('base64');
            return `data:audio/mpeg;base64,${base64}`;

        } catch (error) {
            lastError = error;
            console.error(`[ElevenLabs] TTS Error with key ending in ...${apiKey.slice(-4)}: ${error.message}`);

            // Report error to pool to handle rotation/cooldown
            keyPool.reportError(apiKey, error);
        }
    }

    throw lastError || new Error('ElevenLabs TTS failed with all available keys');
}

/**
 * Check if ElevenLabs service is available
 * @returns {boolean}
 */
function isAvailable() {
    return keyPool.isHealthy();
}

/**
 * Get pool statistics
 */
function getPoolStats() {
    return keyPool.getStats();
}

module.exports = {
    transcribe,
    synthesizeToDataURL,
    pcmToWav,
    isAvailable,
    getPoolStats
};

