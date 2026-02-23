/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Wake Word
 *  Vosk-based wake word detection.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, lib/paths
 *  USED BY:    platform/windows/background-window, platform/windows/voice-window
 * ═══════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');
const logger = require('../../lib/logger');
const paths = require('../../lib/paths');

let isInitialized = false;
let isPaused = false;
let onWakeWordCallback = null;
let voskModelPath = null;

function getModelPath() {
    const modelDir = paths.getVoskModelPath('vosk-model-small-en-us-0.15');
    if (fs.existsSync(modelDir)) {
        return modelDir;
    }
    return null;
}

function initialize() {
    voskModelPath = getModelPath();
    if (!voskModelPath) {
        logger.error('[WakeWord] Vosk model not found');
        return false;
    }
    isInitialized = true;
    logger.info(`[WakeWord] Initialized with model: ${voskModelPath}`);
    return true;
}

function getVoskModelPath() {
    return voskModelPath;
}

function getModelTarGzPath() {
    if (!voskModelPath) return null;
    return path.join(path.dirname(voskModelPath), 'vosk-model.tar.gz');
}

function startDetection(callback) {
    if (!isInitialized) {
        logger.error('[WakeWord] Service not initialized');
        return;
    }
    onWakeWordCallback = callback;
    isPaused = false;
    logger.info('[WakeWord] Started');
}

function pauseDetection() {
    isPaused = true;
    logger.info('[WakeWord] Paused');
}

function resumeDetection() {
    isPaused = false;
    logger.info('[WakeWord] Resumed');
}

function handleDetection(data) {
    if (isPaused || !onWakeWordCallback) return false;
    if (data && data.wakeWord) {
        isPaused = true;
        onWakeWordCallback(data.wakeWord);
        return true;
    }
    return false;
}

module.exports = {
    initialize,
    getModelPath,
    getVoskModelPath,
    getModelTarGzPath,
    startDetection,
    pauseDetection,
    resumeDetection,
    handleDetection,
    get isPaused() { return isPaused; },
};
