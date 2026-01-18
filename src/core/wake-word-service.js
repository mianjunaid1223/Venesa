/**
 * Wake Word Service - Manages openWakeWord ONNX model detection
 */

const path = require('path');
const fs = require('fs');

let isListening = false;
let isPaused = false;
let onWakeWordCallback = null;
let lastDetectionTime = 0;
const DEBOUNCE_MS = 2000;

const MODELS_DIR = path.join(__dirname, '../../models');
const MELSPEC_MODEL = path.join(MODELS_DIR, 'melspectrogram.onnx');
const EMBEDDING_MODEL = path.join(MODELS_DIR, 'embedding_model.onnx');
const WAKEWORD_MODEL = path.join(MODELS_DIR, 'hey_Venessa.onnx');

function modelsExist() {
    return fs.existsSync(MELSPEC_MODEL) &&
        fs.existsSync(EMBEDDING_MODEL) &&
        fs.existsSync(WAKEWORD_MODEL);
}

function getModelPaths() {
    return {
        melspectrogram: MELSPEC_MODEL,
        embedding: EMBEDDING_MODEL,
        wakeword: WAKEWORD_MODEL
    };
}

function initialize() {
    if (!modelsExist()) {
        console.error('[WakeWord] Models not found');
        return false;
    }
    console.log('[WakeWord] Models found, service ready');
    return true;
}

function start(callback) {
    if (!modelsExist()) {
        console.error('[WakeWord] Cannot start - models not found');
        return false;
    }
    onWakeWordCallback = callback;
    isListening = true;
    isPaused = false;
    console.log('[WakeWord] Started listening');
    return true;
}

function pause() {
    isPaused = true;
    console.log('[WakeWord] Paused');
}

function resume() {
    isPaused = false;
    console.log('[WakeWord] Resumed');
}

function stop() {
    isListening = false;
    isPaused = false;
    onWakeWordCallback = null;
    console.log('[WakeWord] Stopped');
}

function handleDetection(wakeWord, score) {
    const now = Date.now();

    if (now - lastDetectionTime < DEBOUNCE_MS) {
        console.log('[WakeWord] Debounced detection');
        return;
    }

    if (!isListening || isPaused) {
        console.log(`[WakeWord] Ignored (listening=${isListening}, paused=${isPaused})`);
        return;
    }

    lastDetectionTime = now;

    // Validate score before using toFixed to avoid TypeError
    const displayScore = Number.isFinite(score) ? score.toFixed(3) : 'N/A';
    console.log(`[WakeWord] Detected "${wakeWord}" with score ${displayScore}`);

    if (onWakeWordCallback) {
        onWakeWordCallback(wakeWord);
    }
}

/**
 * Feed audio buffer for wake word detection.
 * NOTE: This function is intentionally a no-op. Audio processing occurs
 * in the background-audio.html renderer via Web Worker, not through this service.
 * @param {Buffer} audioBuffer - Audio data (ignored)
 */
function feedAudio(audioBuffer) {
    // Intentionally no-op - wake word detection happens in background renderer
    console.warn('[WakeWord] feedAudio called but audio processing occurs in background renderer');
}

module.exports = {
    initialize,
    start,
    pause,
    resume,
    stop,
    handleDetection,
    feedAudio,
    modelsExist,
    getModelPaths,
    get isListening() { return isListening && !isPaused; }
};
