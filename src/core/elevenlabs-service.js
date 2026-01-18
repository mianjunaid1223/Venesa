/**
 * ElevenLabs Service - Unified TTS/STT with API key rotation
 */

const config = require('./config.js');
const keyPool = require('./elevenLabsKeyPool');

keyPool.initialize();

function pcmToWav(pcmBuffer) {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([header, pcmBuffer]);
}

async function transcribe(audioBuffer, options = {}) {
    if (!keyPool.isHealthy()) {
        keyPool.initialize();
        if (!keyPool.isHealthy()) {
            throw new Error('No valid ElevenLabs API keys available');
        }
    }

    const { filename = 'audio.wav', contentType = 'audio/wav' } = options;
    const FormData = require('form-data');
    const maxRetries = keyPool.getAvailableKeyCount();
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const apiKey = keyPool.getNextKey();
        if (!apiKey) break;

        try {
            const form = new FormData();
            form.append('file', audioBuffer, { filename, contentType });
            form.append('model_id', config.stt.model);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout || 30000);

            const response = await fetch(config.endpoints.stt, {
                method: 'POST',
                headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
                body: form.getBuffer(),
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(`STT failed: ${response.status} - ${errorText}`);
                error.status = response.status;
                throw error;
            }

            const result = await response.json();
            keyPool.reportSuccess(apiKey);
            return result.text || '';
        } catch (error) {
            lastError = error;
            console.error(`[ElevenLabs] STT Error: ${error.message}`);
            keyPool.reportError(apiKey, error);
        }
    }

    throw lastError || new Error('ElevenLabs STT failed with all available keys');
}

async function synthesizeToDataURL(text) {
    if (!keyPool.isHealthy()) {
        keyPool.initialize();
        if (!keyPool.isHealthy()) {
            throw new Error('No valid ElevenLabs API keys available');
        }
    }

    if (!text || text.trim().length === 0) return null;

    const maxRetries = keyPool.getAvailableKeyCount();
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const apiKey = keyPool.getNextKey();
        if (!apiKey) break;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout || 30000);

            const response = await fetch(
                `${config.endpoints.tts}/${config.tts.voiceId}?output_format=${config.tts.outputFormat}`,
                {
                    method: 'POST',
                    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text,
                        model_id: config.tts.model,
                        voice_settings: config.tts.voiceSettings
                    }),
                    signal: controller.signal
                }
            ).finally(() => clearTimeout(timeoutId));

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(`TTS failed: ${response.status} - ${errorText}`);
                error.status = response.status;
                throw error;
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            keyPool.reportSuccess(apiKey);
            return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
        } catch (error) {
            lastError = error;
            console.error(`[ElevenLabs] TTS Error: ${error.message}`);
            keyPool.reportError(apiKey, error);
        }
    }

    throw lastError || new Error('ElevenLabs TTS failed with all available keys');
}

function isAvailable() {
    return keyPool.isHealthy();
}

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
