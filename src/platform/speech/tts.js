// TTS — ElevenLabs speech synthesis and transcription.
const logger = require('../../lib/logger');
const keyPool = require('../../lib/key-pool');
const servicesConfig = require('../../brain/services.config');

function pcmToWav(pcmBuffer, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
    const dataSize = pcmBuffer.length;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(buffer, headerSize);

    return buffer;
}

function createMultipartFormData(fields) {
    const boundary = 'VenesaBoundary' + Math.random().toString(36).slice(2);
    const parts = [];

    for (const field of fields) {
        let header = `--${boundary}\r\n`;
        if (field.filename) {
            const safeFilename = (field.filename || 'file').replace(/[^\w.\-]/g, '_');
            header += `Content-Disposition: form-data; name="${field.name}"; filename="${safeFilename}"\r\n`;
            header += `Content-Type: ${field.contentType || 'application/octet-stream'}\r\n\r\n`;
        } else {
            header += `Content-Disposition: form-data; name="${field.name}"\r\n\r\n`;
        }

        const headerBuf = Buffer.from(header, 'utf-8');
        const valueBuf = Buffer.isBuffer(field.value) ? field.value : Buffer.from(String(field.value), 'utf-8');
        parts.push(headerBuf, valueBuf, Buffer.from('\r\n', 'utf-8'));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
    return {
        body: Buffer.concat(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

async function synthesize(text) {
    const apiKey = keyPool.getNextKey('elevenlabs');
    if (!apiKey) throw new Error('No ElevenLabs API key available');

    if (!servicesConfig || !servicesConfig.elevenlabs || !servicesConfig.elevenlabs.tts) {
        throw new Error('ElevenLabs TTS configuration is missing or incomplete in services.config');
    }

    const config = servicesConfig.elevenlabs.tts;
    const url = `${servicesConfig.elevenlabs.baseUrl}/text-to-speech/${config.voiceId}?output_format=${config.outputFormat}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
                text,
                model_id: config.model,
                voice_settings: {
                    stability: config.stability,
                    similarity_boost: config.similarityBoost,
                    style: config.style,
                    use_speaker_boost: config.useSpeakerBoost,
                },
            }),
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const err = new Error(`ElevenLabs TTS failed: ${response.status} ${bodyText}`);
        err.status = response.status;
        keyPool.reportError('elevenlabs', apiKey, err);
        throw err;
    }

    keyPool.reportSuccess('elevenlabs', apiKey);
    return Buffer.from(await response.arrayBuffer());
}

async function synthesizeToDataURL(text) {
    const audioBuffer = await synthesize(text);
    const base64 = audioBuffer.toString('base64');
    // Derive MIME type from the configured output format
    const fmt = (servicesConfig?.elevenlabs?.tts?.outputFormat || '').toLowerCase();
    let mimeType = 'audio/mpeg';
    if (fmt.includes('wav') || fmt.includes('pcm')) mimeType = 'audio/wav';
    else if (fmt.includes('ogg')) mimeType = 'audio/ogg';
    else if (fmt.includes('flac')) mimeType = 'audio/flac';
    return `data:${mimeType};base64,${base64}`;
}

async function transcribe(audioBuffer, options = {}) {
    const apiKey = keyPool.getNextKey('elevenlabs');
    if (!apiKey) throw new Error('No ElevenLabs API key available');

    const config = servicesConfig.elevenlabs.stt;
    const filename = options.filename || 'audio.wav';
    const contentType = options.contentType || 'audio/wav';

    const { body, contentType: formContentType } = createMultipartFormData([
        { name: 'file', value: audioBuffer, filename, contentType },
        { name: 'model_id', value: config.model },
        { name: 'language_code', value: config.language },
    ]);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
        response = await fetch(`${servicesConfig.elevenlabs.baseUrl}/speech-to-text`, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': formContentType,
            },
            signal: controller.signal,
            body,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const err = new Error(`ElevenLabs STT failed: ${response.status} ${bodyText}`);
        err.status = response.status;
        keyPool.reportError('elevenlabs', apiKey, err);
        throw err;
    }

    keyPool.reportSuccess('elevenlabs', apiKey);
    const result = await response.json();
    return result.text || '';
}

function isAvailable() {
    return keyPool.hasKeys('elevenlabs');
}

module.exports = {
    synthesize,
    synthesizeToDataURL,
    transcribe,
    isAvailable,
    pcmToWav,
};
