/**
 * Wake Word Service
 * Manages wake word detection using openWakeWord ONNX models
 * Pipeline: Audio -> Melspectrogram -> Embedding -> Wake Word Model
 */

const path = require('path');
const fs = require('fs');

// Wake word detection state
let wakeWordWorker = null;
let isListening = false;
let isPaused = false;
let onWakeWordCallback = null;
let lastDetectionTime = 0;
const DEBOUNCE_MS = 2000; // Prevent double triggers

// Model paths
const MODELS_DIR = path.join(__dirname, '../models');
const MELSPEC_MODEL = path.join(MODELS_DIR, 'melspectrogram.onnx');
const EMBEDDING_MODEL = path.join(MODELS_DIR, 'embedding_model.onnx');
const WAKEWORD_MODEL = path.join(MODELS_DIR, 'hey_Venessa.onnx');

/**
 * Check if all required models exist
 */
function modelsExist() {
    return fs.existsSync(MELSPEC_MODEL) &&
        fs.existsSync(EMBEDDING_MODEL) &&
        fs.existsSync(WAKEWORD_MODEL);
}

/**
 * Get model paths for the worker
 */
function getModelPaths() {
    return {
        melspectrogram: MELSPEC_MODEL,
        embedding: EMBEDDING_MODEL,
        wakeword: WAKEWORD_MODEL
    };
}

/**
 * Initialize wake word worker in the background window
 * The actual ONNX inference happens in the renderer process via Web Worker
 */
function initialize() {
    if (!modelsExist()) {
        console.error('[WakeWord] Models not found. Expected paths:');
        console.error(`  - ${MELSPEC_MODEL}`);
        console.error(`  - ${EMBEDDING_MODEL}`);
        console.error(`  - ${WAKEWORD_MODEL}`);
        return false;
    }

    console.log('[WakeWord] Models found, service ready');
    return true;
}

/**
 * Start listening for wake word
 * @param {Function} callback - Called when wake word is detected
 */
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

/**
 * Pause wake word detection (while voice window is active)
 */
function pause() {
    isPaused = true;
    console.log('[WakeWord] Paused');
}

/**
 * Resume wake word detection
 */
function resume() {
    isPaused = false;
    console.log('[WakeWord] Resumed');
}

/**
 * Stop wake word detection
 */
function stop() {
    isListening = false;
    isPaused = false;
    onWakeWordCallback = null;
    console.log('[WakeWord] Stopped');
}

/**
 * Handle wake word detection from background audio window
 * @param {string} wakeWord - Detected wake word name
 * @param {number} score - Detection confidence score
 */
function handleDetection(wakeWord, score) {
    const now = Date.now();

    // Debounce to prevent multiple triggers
    if (now - lastDetectionTime < DEBOUNCE_MS) {
        console.log(`[WakeWord] Debounced detection (within ${DEBOUNCE_MS}ms)`);
        return;
    }

    // Only trigger if listening and not paused
    if (!isListening || isPaused) {
        console.log(`[WakeWord] Ignored (listening=${isListening}, paused=${isPaused})`);
        return;
    }

    lastDetectionTime = now;
    console.log(`[WakeWord] Detected "${wakeWord}" with score ${score.toFixed(3)}`);

    if (onWakeWordCallback) {
        onWakeWordCallback(wakeWord);
    }
}

/**
 * Feed audio data to wake word detector
 * This is a placeholder - actual processing happens in background audio window
 * @param {Buffer} audioBuffer - PCM audio data
 */
function feedAudio(audioBuffer) {
    // Audio processing is done in the background-audio.html renderer
    // This function exists for API compatibility
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
