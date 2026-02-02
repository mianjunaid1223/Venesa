const servicesConfig = require('../config/services.config');
const keyPool = require('./apiKeyPool');
const logger = require('./logger');

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
    let apiKey = await keyPool.getNextKey('elevenlabs');
    if (!apiKey) throw new Error('No valid ElevenLabs API keys available');

    const { filename = 'audio.wav', contentType = 'audio/wav' } = options;
    const FormData = require('form-data');

    // Simple retry loop (max 2 attempts) to handle potential sudden key death
    for (let i = 0; i < 2; i++) {
        try {
            const form = new FormData();
            form.append('file', audioBuffer, { filename, contentType });
            form.append('model_id', servicesConfig.elevenlabs.stt.model);
            form.append('language_code', servicesConfig.elevenlabs.stt.language);

            const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
                method: 'POST',
                headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
                body: form.getBuffer()
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    keyPool.reportError('elevenlabs', apiKey, { status: response.status });
                    apiKey = await keyPool.getNextKey('elevenlabs');
                    if (!apiKey) throw new Error('All keys exhausted');
                    continue;
                }
                const errorText = await response.text();
                throw new Error(`STT failed: ${response.status} - ${errorText}`);
            }

            return (await response.json()).text || '';

        } catch (error) {
            logger.error(`STT error: ${error.message}`);
            if (i === 1) throw error;
        }
    }
}

async function synthesizeToDataURL(text) {
    if (!text || text.trim().length === 0) return null;

    let apiKey = await keyPool.getNextKey('elevenlabs');
    if (!apiKey) throw new Error('No valid ElevenLabs API keys available');

    for (let i = 0; i < 2; i++) {
        try {
            const ttsConfig = servicesConfig.elevenlabs.tts;
            const response = await fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${ttsConfig.voiceId}?output_format=${ttsConfig.outputFormat}`,
                {
                    method: 'POST',
                    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text,
                        model_id: ttsConfig.model,
                        voice_settings: {
                            stability: ttsConfig.stability,
                            similarity_boost: ttsConfig.similarityBoost,
                            style: ttsConfig.style,
                            use_speaker_boost: ttsConfig.useSpeakerBoost
                        }
                    })
                }
            );

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    keyPool.reportError('elevenlabs', apiKey, { status: response.status });
                    apiKey = await keyPool.getNextKey('elevenlabs');
                    if (!apiKey) throw new Error('All keys exhausted');
                    continue;
                }
                const errorText = await response.text();
                throw new Error(`TTS failed: ${response.status} - ${errorText}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
        } catch (error) {
            logger.error(`TTS error: ${error.message}`);
            if (i === 1) throw error;
        }
    }
}

function isAvailable() {
    return keyPool.hasKeys('elevenlabs');
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
