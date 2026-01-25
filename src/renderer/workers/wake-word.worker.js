/**
 * Wake Word Worker
 * Web Worker for openWakeWord ONNX inference pipeline
 * 
 * Pipeline:
 * [Audio 1280 samples] -> melspectrogram.onnx -> transform -> buffer (76 frames)
 * -> embedding_model.onnx -> buffer (16 embeddings) -> hey_vuh_ness_uh.onnx -> score
 */

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');

// ONNX Runtime configuration
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

// Model sessions
let melspecSession = null;
let embeddingSession = null;
let wakewordSession = null;

// Audio processing constants
const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 1280;  // 80ms at 16kHz
const MEL_FRAMES_PER_CHUNK = 5;  // Each 80ms chunk produces 5 mel frames
const MEL_BINS = 32;  // Number of mel frequency bins

// Buffers
let melBuffer = [];  // Buffer for mel spectrogram frames (needs 76 for embedding)
let embeddingBuffer = [];  // Buffer for embeddings (needs 16 for wake word)

// Detection settings
const THRESHOLD = 0.5;  // Wake word detection threshold
const MEL_BUFFER_SIZE = 76;  // Frames needed for embedding model
const EMBEDDING_BUFFER_SIZE = 16;  // Embeddings needed for wake word model
const EMBEDDING_SLIDE = 8;  // Frames to slide after embedding inference

// State
let isInitialized = false;
let modelPaths = null;

/**
 * Initialize ONNX models from ArrayBuffers
 */
async function initializeModels(modelBuffers) {
    try {
        console.log('[Worker] Initializing ONNX models from buffers...');

        // Create inference sessions from the provided ArrayBuffers
        const sessionOptions = {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        };

        [melspecSession, embeddingSession, wakewordSession] = await Promise.all([
            ort.InferenceSession.create(modelBuffers.melspectrogram, sessionOptions),
            ort.InferenceSession.create(modelBuffers.embedding, sessionOptions),
            ort.InferenceSession.create(modelBuffers.wakeword, sessionOptions)
        ]);

        console.log('[Worker] All models loaded successfully');
        console.log('[Worker] Melspec inputs:', melspecSession.inputNames, 'outputs:', melspecSession.outputNames);
        console.log('[Worker] Embedding inputs:', embeddingSession.inputNames, 'outputs:', embeddingSession.outputNames);
        console.log('[Worker] Wakeword inputs:', wakewordSession.inputNames, 'outputs:', wakewordSession.outputNames);

        isInitialized = true;
        self.postMessage({ type: 'ready' });

    } catch (error) {
        console.error('[Worker] Model initialization failed:', error);
        self.postMessage({ type: 'error', error: error.message });
    }
}

/**
 * Transform melspectrogram output as required by openWakeWord
 * Formula: output = (value / 10.0) + 2.0
 */
function transformMelOutput(data) {
    const transformed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
        transformed[i] = (data[i] / 10.0) + 2.0;
    }
    return transformed;
}

/**
 * Process audio chunk through the pipeline
 * @param {Float32Array} audioData - 1280 samples of audio (80ms at 16kHz)
 */
async function processAudioChunk(audioData) {
    if (!isInitialized) return;

    try {
        // Step 1: Audio -> Melspectrogram
        const melInput = new ort.Tensor('float32', audioData, [1, CHUNK_SIZE]);
        const melResult = await melspecSession.run({ [melspecSession.inputNames[0]]: melInput });
        const melOutput = melResult[melspecSession.outputNames[0]];

        // Transform mel output and extract frames
        const transformedMel = transformMelOutput(melOutput.data);

        // Each chunk produces ~5 frames of 32 mel bins
        for (let i = 0; i < MEL_FRAMES_PER_CHUNK; i++) {
            const frame = transformedMel.slice(i * MEL_BINS, (i + 1) * MEL_BINS);
            // Deep copy to avoid ONNX Runtime buffer reuse issues
            melBuffer.push(new Float32Array(frame));
        }

        // Step 2: Mel buffer -> Embedding (when we have enough frames)
        while (melBuffer.length >= MEL_BUFFER_SIZE) {
            // Take 76 frames for embedding
            const melWindow = melBuffer.slice(0, MEL_BUFFER_SIZE);

            // Flatten to (1, 76, 32, 1) shape
            const melData = new Float32Array(MEL_BUFFER_SIZE * MEL_BINS);
            for (let i = 0; i < MEL_BUFFER_SIZE; i++) {
                for (let j = 0; j < MEL_BINS; j++) {
                    melData[i * MEL_BINS + j] = melWindow[i][j];
                }
            }

            const embInput = new ort.Tensor('float32', melData, [1, MEL_BUFFER_SIZE, MEL_BINS, 1]);
            const embResult = await embeddingSession.run({ [embeddingSession.inputNames[0]]: embInput });
            const embOutput = embResult[embeddingSession.outputNames[0]];

            // Deep copy embedding (96 features)
            embeddingBuffer.push(new Float32Array(embOutput.data));

            // Slide mel buffer by 8 frames
            melBuffer = melBuffer.slice(EMBEDDING_SLIDE);

            // Step 3: Embedding buffer -> Wake word detection (when we have enough embeddings)
            if (embeddingBuffer.length >= EMBEDDING_BUFFER_SIZE) {
                await runWakeWordDetection();
            }
        }

    } catch (error) {
        console.error('[Worker] Audio processing error:', error);
    }
}

/**
 * Run wake word detection on embedding buffer
 */
async function runWakeWordDetection() {
    if (embeddingBuffer.length < EMBEDDING_BUFFER_SIZE) return;

    try {
        // Take 16 embeddings
        const embWindow = embeddingBuffer.slice(0, EMBEDDING_BUFFER_SIZE);
        const featureSize = embWindow[0].length; // Should be 96

        // Flatten to (1, 16, 96) shape
        const inputData = new Float32Array(EMBEDDING_BUFFER_SIZE * featureSize);
        for (let i = 0; i < EMBEDDING_BUFFER_SIZE; i++) {
            for (let j = 0; j < featureSize; j++) {
                inputData[i * featureSize + j] = embWindow[i][j];
            }
        }

        const wakeInput = new ort.Tensor('float32', inputData, [1, EMBEDDING_BUFFER_SIZE, featureSize]);
        const wakeResult = await wakewordSession.run({ [wakewordSession.inputNames[0]]: wakeInput });
        const scores = wakeResult[wakewordSession.outputNames[0]].data;

        // Get the wake word score (assuming single output)
        const score = scores[0];

        // Send score to main thread for monitoring
        self.postMessage({ type: 'score', score: score });

        // Check for detection
        if (score > THRESHOLD) {
            self.postMessage({ type: 'detection', wakeWord: 'hey_venessa', score: score });
        }

        // Slide embedding buffer by 1
        embeddingBuffer = embeddingBuffer.slice(1);

    } catch (error) {
        console.error('[Worker] Wake word detection error:', error);
    }
}

/**
 * Handle messages from main thread
 */
self.onmessage = async function (event) {
    const { type, data } = event.data;

    switch (type) {
        case 'init':
            await initializeModels(data.modelBuffers);
            break;

        case 'audio':
            // Convert Int16 PCM to Float32
            const int16 = new Int16Array(data.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / 32768.0;
            }
            await processAudioChunk(float32);
            break;

        case 'reset':
            melBuffer = [];
            embeddingBuffer = [];
            break;

        default:
            console.warn('[Worker] Unknown message type:', type);
    }
};

console.log('[Worker] Wake word worker loaded');
