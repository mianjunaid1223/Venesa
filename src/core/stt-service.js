/**
 * STT Service - Voice Activity Detection + HTTP POST to ElevenLabs
 */

const elevenlabsService = require('./elevenlabs-service.js');

const CONFIG = {
    SPEECH_THRESHOLD: 0.01,
    SILENCE_DURATION: 1200, // Increased to allow natural pauses
    MIN_RECORDING: 600,     // Increased to filter short noises
    MAX_RECORDING: 10000,
    PRE_ROLL_FRAMES: 5
};

let isListening = false;
let isProcessing = false;
let userCallback = null;
let audioChunks = [];
let preRollBuffer = [];
let isRecording = false;
let lastSpeechTime = 0;
let recordingStartTime = 0;

function initialize() {
    console.log('[STT] Service initialized');
    return true;
}

function start(cb) {
    userCallback = cb;
    isListening = true;
    isProcessing = false;
    resetState();
    if (userCallback) userCallback('ready', '');
    console.log('[STT] Started listening');
}

function stop() {
    isListening = false;
    isProcessing = false;
    resetState();
    console.log('[STT] Stopped');
}

function resetState() {
    audioChunks = [];
    preRollBuffer = [];
    isRecording = false;
    lastSpeechTime = 0;
    recordingStartTime = 0;
}

function feedAudio(data) {
    if (!isListening || isProcessing) return;

    const rms = calculateRMS(data);
    const now = Date.now();
    const isSpeech = rms > CONFIG.SPEECH_THRESHOLD;

    if (isRecording) {
        audioChunks.push(data);

        if (isSpeech) {
            lastSpeechTime = now;
            if (userCallback && Math.random() < 0.1) {
                userCallback('partial', 'Listening...');
            }
        }

        const silenceDuration = now - lastSpeechTime;
        const recordingDuration = now - recordingStartTime;

        if (silenceDuration > CONFIG.SILENCE_DURATION) {
            console.log('[STT] End of speech detected');
            processBuffer();
        } else if (recordingDuration > CONFIG.MAX_RECORDING) {
            console.log('[STT] Max duration reached');
            processBuffer();
        }
    } else {
        preRollBuffer.push(data);
        if (preRollBuffer.length > CONFIG.PRE_ROLL_FRAMES) {
            preRollBuffer.shift();
        }

        if (isSpeech) {
            console.log('[STT] Speech detected');
            isRecording = true;
            lastSpeechTime = now;
            recordingStartTime = now;
            audioChunks = [...preRollBuffer];
            preRollBuffer = [];
            audioChunks.push(data);
            if (userCallback) userCallback('partial', 'Listening...');
        }
    }
}

async function processBuffer() {
    if (audioChunks.length === 0) {
        resetState();
        return;
    }

    const fullBuffer = Buffer.concat(audioChunks);
    const minBytes = 16000 * 2 * (CONFIG.MIN_RECORDING / 1000);

    if (fullBuffer.length < minBytes) {
        console.log('[STT] Audio too short, ignoring');
        resetState();
        return;
    }

    isProcessing = true;
    resetState();

    if (userCallback) userCallback('partial', 'Processing...');

    try {
        console.log(`[STT] Uploading ${fullBuffer.length} bytes`);
        const wavBuffer = elevenlabsService.pcmToWav(fullBuffer);
        const text = await elevenlabsService.transcribe(wavBuffer);

        if (text && text.trim()) {
            console.log('[STT] Text:', text);
            if (userCallback) userCallback('text', text);
            isListening = false;
            isProcessing = false;
        } else {
            if (userCallback) userCallback('partial', '...');
            isProcessing = false;
        }
    } catch (error) {
        console.error('[STT] Error:', error);
        if (userCallback) userCallback('partial', 'Error');
        isProcessing = false;
    }
}

function calculateRMS(buffer) {
    // Guard against empty buffer to avoid NaN
    if (!buffer || buffer.length < 2) {
        return 0;
    }
    const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    if (int16.length === 0) {
        return 0;
    }
    let sum = 0;
    for (let i = 0; i < int16.length; i++) {
        const val = int16[i] / 32768.0;
        sum += val * val;
    }
    return Math.sqrt(sum / int16.length);
}

module.exports = {
    initialize,
    start,
    stop,
    pause: stop,
    resume: (cb) => {
        // Full state reset for consistency, whether callback provided or not
        audioChunks = [];
        preRollBuffer = [];
        isRecording = false;
        lastSpeechTime = 0;
        recordingStartTime = 0;
        if (cb) {
            start(cb);
        } else {
            isListening = true;
            isProcessing = false;
        }
    },
    feedAudio,
    get isListening() { return isListening; }
};
