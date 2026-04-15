/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: STT (Speech-to-Text)
 *  Audio recording, VAD, and ElevenLabs transcription pipeline.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, platform/speech/tts
 *  USED BY:    platform/ipc/voice-handlers, platform/windows/voice-window
 * ═══════════════════════════════════════════════════════════════
 */

const logger = require('../../lib/logger');
const ttsService = require('./tts');

const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;
const RMS_THRESHOLD = 0.015;
const SILENCE_TIMEOUT = 1500;
const MIN_AUDIO_LENGTH = 0.5;
const MAX_AUDIO_LENGTH = 30;

let isListening = false;
let isRecording = false;
let isProcessingRecording = false;
let audioChunks = [];
let silenceTimer = null;
let onResultCallback = null;
let recordingStartTime = 0;

function calculateRMS(buffer) {
    let sum = 0;
    const workBuffer = (buffer.byteOffset % 2 !== 0) ? Buffer.from(buffer) : buffer;
    const samples = new Int16Array(workBuffer.buffer, workBuffer.byteOffset, Math.floor(workBuffer.length / 2));
    if (samples.length === 0) return 0;
    for (const sample of samples) {
        const normalized = sample / 32768;
        sum += normalized * normalized;
    }
    return Math.sqrt(sum / samples.length);
}

function initialize() {
    logger.info('STT service initialized (ElevenLabs provider)');
}

function start(callback) {
    if (isListening) return;
    isListening = true;
    isRecording = false;
    audioChunks = [];
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    onResultCallback = callback;
    logger.info('STT listening started');
}

function stop() {
    isListening = false;
    isRecording = false;
    isProcessingRecording = false;
    audioChunks = [];
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    onResultCallback = null;
    logger.info('STT listening stopped');
}

function feedAudio(buffer) {
    if (!isListening) return;

    const rms = calculateRMS(buffer);
    const isSpeech = rms > RMS_THRESHOLD;

    if (isSpeech) {
        if (!isRecording) {
            isRecording = true;
            audioChunks = [];
            recordingStartTime = Date.now();
            logger.debug('Speech detected — recording started');
        }
        audioChunks.push(buffer);

        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }

        silenceTimer = setTimeout(() => {
            processRecording();
        }, SILENCE_TIMEOUT);

        const elapsed = (Date.now() - recordingStartTime) / 1000;
        if (elapsed >= MAX_AUDIO_LENGTH) {
            processRecording();
        }
    } else if (isRecording) {
        audioChunks.push(buffer);
    }
}

async function processRecording() {
    if (!isRecording || audioChunks.length === 0 || isProcessingRecording) return;

    // Guard: skip transcription if ElevenLabs is not available
    if (!ttsService.isAvailable()) {
        logger.warn('STT skipped: no ElevenLabs API key available');
        audioChunks = [];
        isRecording = false;
        return;
    }

    isProcessingRecording = true;

    try {
        isRecording = false;
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }

        const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const durationSeconds = totalLength / (SAMPLE_RATE * 2);

        if (durationSeconds < MIN_AUDIO_LENGTH) {
            logger.debug(`Audio too short (${durationSeconds.toFixed(2)}s) — ignoring`);
            audioChunks = [];
            isProcessingRecording = false;
            return;
        }

        const combinedBuffer = Buffer.concat(audioChunks);
        audioChunks = [];
        const wavBuffer = ttsService.pcmToWav(combinedBuffer, SAMPLE_RATE, 1, 16);
        const text = await ttsService.transcribe(wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });

        const rawTrimmed = (text || '').trim();
        const cleanedText = rawTrimmed.replace(/\([^)]+\)/g, '').replace(/\[[^\]]+\]/g, '').replace(/\*([^*]+)\*/g, '').replace(/_+/g, '').trim();

        if (cleanedText) {
            logger.info(`STT Transcript: "${rawTrimmed}"`);
            if (isListening && onResultCallback) {
                onResultCallback('text', cleanedText); // Use cleaned text
            }
        } else if (rawTrimmed) {
            logger.debug(`STT Noise (ignored): "${rawTrimmed}"`);
        } else {
            logger.debug('STT returned empty result');
        }
    } catch (e) {
        logger.error(`STT processing failed: ${e.message}`);
    } finally {
        isProcessingRecording = false;
    }
}

module.exports = {
    initialize,
    start,
    stop,
    feedAudio,
    get isListening() { return isListening; },
};
