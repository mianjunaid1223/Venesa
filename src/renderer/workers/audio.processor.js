class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
            const data = new Float32Array(input[0]);
            this.port.postMessage({ type: 'audio', buffer: data });
        }
        return true;
    }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
