const path = require('path');
const fs = require('fs');

let isInitialized = false;
let isPaused = false;
let onWakeWordCallback = null;
let voskModelPath = null;

function getModelPath() {
    const modelDir = path.join(__dirname, '../../models/vosk-model-small-en-us-0.15');
    if (fs.existsSync(modelDir)) {
        return modelDir;
    }
    return null;
}

function initialize() {
    voskModelPath = getModelPath();
    if (!voskModelPath) {
        console.error('[WakeWord] Vosk model not found');
        return false;
    }
    isInitialized = true;
    console.log('[WakeWord] Initialized with model:', voskModelPath);
    return true;
}

function getVoskModelPath() {
    return voskModelPath;
}

function start(callback) {
    if (!isInitialized) {
        console.error('[WakeWord] Service not initialized');
        return;
    }
    onWakeWordCallback = callback;
    isPaused = false;
    console.log('[WakeWord] Started');
}

function pause() {
    isPaused = true;
    console.log('[WakeWord] Paused');
}

function resume() {
    isPaused = false;
    console.log('[WakeWord] Resumed');
}

function handleDetection(text) {
    if (isPaused || !onWakeWordCallback) return false;

    if (typeof text !== 'string') {
        if (text && text.wakeWord) {
            isPaused = true;
            onWakeWordCallback('hey_venessa');
            return true;
        }
        return false;
    }

    const cleanText = text.toLowerCase().trim();
    const wakePatterns = [
        /hey\s*v[ei]n[aeiou]?s+[aeu]/i,
        /hey\s*vanessa/i,
        /hey\s*venesa/i,
        /hey\s*venus/i,
        /a\s*v[ei]n[aeiou]?s+[aeu]/i
    ];

    for (const pattern of wakePatterns) {
        if (pattern.test(cleanText)) {
            console.log('[WakeWord] Detected:', cleanText);
            isPaused = true;
            onWakeWordCallback('hey_venessa');
            return true;
        }
    }
    return false;
}

module.exports = {
    initialize,
    getVoskModelPath,
    start,
    pause,
    resume,
    handleDetection,
    get isPaused() { return isPaused; }
};
