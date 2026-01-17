/**
 * STT Service (formerly vosk-service)
 * 
 * Implements a Robust VAD (Voice Activity Detection) + HTTP POST architecture.
 * This ensures "Smooth" operation by:
 * 1. Listening to the microphone continuously.
 * 2. Detecting speech with low latency (RMS Threshold).
 * 3. Buffering audio while you speak.
 * 4. Automatically sending audio to ElevenLabs when you pause.
 * 
 * Why this over Streaming?
 * - Higher reliability (no 403 Forbidden errors).
 * - Better accuracy (Scribe v1 full-context).
 * - No complexity with WebSocket connections dropping.
 */

const elevenlabsService = require('./elevenlabs-service.js');

// Configuration for "Magic" feel
const CONFIG = {
    SPEECH_THRESHOLD: 0.01,       // 1% Amplitude - Sensitive enough for normal voice
    SILENCE_DURATION: 800,        // Wait 0.8s silence before sending (Quick response)
    MIN_RECORDING: 400,           // Ignore blips shorter than 0.4s
    MAX_RECORDING: 10000,         // Max 10s per command
    PRE_ROLL_FRAMES: 5            // Keep 5 frames before speech to catch start of words
};

// State
let isListening = false;
let userCallback = null;
let audioChunks = [];
let preRollBuffer = [];
let isRecording = false;
let lastSpeechTime = 0;
let recordingStartTime = 0;
let silenceTimer = null;

/**
 * Initialize
 */
function initialize() {
    console.log('[STT] Service initialized (VAD+HTTP Mode)');
    return true;
}

/**
 * Start Listening
 */
function start(cb) {
    userCallback = cb;
    isListening = true;
    resetState();

    if (userCallback) {
        userCallback('ready', '');
    }
    console.log('[STT] Started listening');
}

/**
 * Stop Listening
 */
function stop() {
    isListening = false;
    resetState();
    if (silenceTimer) clearTimeout(silenceTimer);
    console.log('[STT] Stopped');
}

/**
 * Reset State
 */
function resetState() {
    audioChunks = [];
    preRollBuffer = [];
    isRecording = false;
    lastSpeechTime = 0;
    recordingStartTime = 0;
    if (silenceTimer) clearTimeout(silenceTimer);
}

/**
 * Feed Audio from Main Process
 */
function feedAudio(data) {
    if (!isListening) return;

    // 1. Calculate Volume (RMS)
    const rms = calculateRMS(data);
    const now = Date.now();
    const isSpeech = rms > CONFIG.SPEECH_THRESHOLD;

    // 2. Logic Machine
    if (isRecording) {
        // We are currently recording a command
        audioChunks.push(data);

        if (isSpeech) {
            lastSpeechTime = now; // Reset silence timer

            // Visual Feedback
            if (userCallback && Math.random() < 0.1) {
                userCallback('partial', 'Listening...');
            }
        }

        // Check for Silence Timeout or Max Duration
        const silenceDuration = now - lastSpeechTime;
        const recordingDuration = now - recordingStartTime;

        if (silenceDuration > CONFIG.SILENCE_DURATION) {
            console.log('[STT] End of speech detected.');
            processBuffer();
        } else if (recordingDuration > CONFIG.MAX_RECORDING) {
            console.log('[STT] Max duration reached.');
            processBuffer();
        }

    } else {
        // We are waiting for speech
        preRollBuffer.push(data);
        if (preRollBuffer.length > CONFIG.PRE_ROLL_FRAMES) {
            preRollBuffer.shift(); // Keep buffer rolling
        }

        if (isSpeech) {
            console.log('[STT] Speech detected!');
            isRecording = true;
            lastSpeechTime = now;
            recordingStartTime = now;

            // Move pre-roll to active buffer
            audioChunks = [...preRollBuffer];
            preRollBuffer = [];
            audioChunks.push(data);

            if (userCallback) userCallback('partial', 'Listening...');
        }
    }
}

/**
 * Process the buffered audio
 */
async function processBuffer() {
    if (audioChunks.length === 0) {
        resetState();
        return;
    }

    // Combine chunks
    const fullBuffer = Buffer.concat(audioChunks);

    // Check min length to avoid noise triggers
    // 16kHz * 2 bytes * seconds
    const minBytes = 16000 * 2 * (CONFIG.MIN_RECORDING / 1000);

    if (fullBuffer.length < minBytes) {
        console.log('[STT] Audio too short, ignoring.');
        resetState();
        return;
    }

    // Stop recording state, but keep listening state? 
    // Usually we want to pause listening while we think.
    // But for a smooth "Wake Word -> Speak -> Result" flow:

    resetState(); // Reset immediately for next phrase

    if (userCallback) userCallback('partial', 'Processing...');

    // Transcribe
    try {
        console.log(`[STT] Uploading ${fullBuffer.length} bytes...`);
        const wavBuffer = elevenlabsService.pcmToWav(fullBuffer);
        const text = await elevenlabsService.transcribe(wavBuffer);

        if (text && text.trim()) {
            console.log('[STT] Text:', text);
            if (userCallback) userCallback('text', text);
        } else {
            if (userCallback) userCallback('partial', '...');
        }
    } catch (error) {
        console.error('[STT] Error:', error);
        if (userCallback) userCallback('partial', 'Error');
    }
}

/**
 * Helper: Calculate Root Mean Square
 */
function calculateRMS(buffer) {
    const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    let sum = 0;
    for (let i = 0; i < int16.length; i++) {
        const val = int16[i] / 32768.0;
        sum += val * val;
    }
    return Math.sqrt(sum / int16.length);
}

// Exports
module.exports = {
    initialize,
    start,
    stop,
    pause: stop,
    resume: (cb) => { if (cb) start(cb); else isListening = true; },
    feedAudio,
    get isListening() { return isListening; }
};
