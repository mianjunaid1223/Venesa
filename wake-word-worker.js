// Wake Word Worker - Lightweight Vosk listener for background wake word detection
const vosk = require('vosk');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const MODEL_PATH = path.join(__dirname, 'models', 'vosk-model-small-en-us-0.15');
const SAMPLE_RATE = 16000;

if (!fs.existsSync(MODEL_PATH)) {
    console.error(JSON.stringify({ error: `Model not found at ${MODEL_PATH}` }));
    process.exit(1);
}

// Lower log level for quiet operation
vosk.setLogLevel(-1);

const model = new vosk.Model(MODEL_PATH);
const recognizer = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE });

// Read raw PCM audio from stdin
process.stdin.on('data', (data) => {
    if (recognizer.acceptWaveform(data)) {
        const result = recognizer.result();
        if (result.text && result.text.length > 0) {
            console.log(JSON.stringify({ type: 'result', text: result.text }));
        }
    } else {
        const partial = recognizer.partialResult();
        if (partial.partial && partial.partial.length > 0) {
            console.log(JSON.stringify({ type: 'partial', text: partial.partial }));
        }
    }
});

process.stdin.on('end', () => {
    recognizer.free();
    model.free();
    process.exit(0);
});

process.stdin.on('error', (err) => {
    console.error(JSON.stringify({ error: err.message }));
});

// Signal ready
console.log(JSON.stringify({ type: 'status', status: 'ready' }));
