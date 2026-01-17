/**
 * Vosk Service - Now wrapping ElevenLabs Streaming STT
 * Re-implemented for continuous streaming with NO local thresholds.
 */

const streamingService = require('./elevenlabs-streaming.js');

// State
let isListening = false;
let userCallback = null;

/**
 * Initialize the STT service
 */
function initialize() {
    console.log('[STT] Streaming service ready');
    return true;
}

/**
 * Start listening and processing audio
 * @param {Function} cb - Callback for STT results (type, text)
 */
function start(cb) {
    userCallback = cb;
    isListening = true;

    // Signal ready immediately
    if (userCallback) {
        userCallback('ready', '');
    }

    // Start streaming connection
    streamingService.start((msg) => {
        if (!userCallback) return;

        // Map ElevenLabs events to our app events
        // Expected msg: { type: 'partial' | 'final', text: '...', ... }

        // Scribe v2 returns 'is_final' or type 'final'
        const text = (msg.text || msg.content || '').trim();
        const type = msg.type;

        if (text) {
            if (type === 'final' || msg.is_final) {
                console.log('[STT] Final:', text);
                userCallback('text', text);
            } else {
                // Partial result
                userCallback('partial', text);
            }
        }
    });

    console.log('[STT] Started streaming (No Local Threshold)');
}

/**
 * Feed audio data for processing
 * @param {Buffer} data - PCM audio data (16-bit, 16kHz, mono)
 */
function feedAudio(data) {
    // If we are listening, we ALWAYS stream.
    // Logic: "remove voice threshold, as user wake it up, it should start recording"
    // The server-side VAD/Silence detection of the model will handle segmentation if we strictly use the streaming API.

    if (!isListening) return;

    // Send directly to streaming service
    streamingService.sendAudio(data);
}

/**
 * Pause STT processing
 */
function pause() {
    isListening = false;
    streamingService.stop(); // Close connection to save resources/stop billing
    console.log('[STT] Paused');
}

/**
 * Resume STT processing  
 */
function resume() {
    if (!isListening) {
        isListening = true;
        // Check if we need to restart the service (if connection was closed)
        if (!streamingService.isConnected) {
            // We need the callback to restart properly... 
            // Ideally 'resume' is called only after 'start' has set the callback.
            if (userCallback) start(userCallback);
        }
    }
    console.log('[STT] Resumed');
}

/**
 * Stop STT processing
 */
function stop() {
    isListening = false;
    streamingService.stop();
    userCallback = null;
    console.log('[STT] Stopped');
}

// Clean up unused/legacy function to avoid errors if called
function processAccumulatedAudio() {
    // No-op
}

module.exports = {
    initialize,
    start,
    pause,
    resume,
    stop,
    feedAudio,
    processAccumulatedAudio, // kept for interface compatibility
    get isWorkerReady() { return true; },
    get isListening() { return isListening; }
};
