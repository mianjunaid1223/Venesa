/**
 * Audio Capture Processor - AudioWorklet for voice window
 * Captures audio data and sends it to the main thread
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
            // Clone the data since it's reused by the browser
            const data = new Float32Array(input[0]);

            // Send audio data to main thread
            this.port.postMessage({
                type: 'audio',
                buffer: data
            });
        }
        return true;
    }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
