class VoskAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 1024;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        
        this.port.onmessage = (event) => {
            if (event.data.action === 'init') {
            }
        };
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input && input.length > 0 && input[0]) {
            const inputChannel = input[0];
            
            for (let i = 0; i < inputChannel.length; i++) {
                this.buffer[this.bufferIndex] = inputChannel[i];
                this.bufferIndex++;
                
                if (this.bufferIndex >= this.bufferSize) {
                    this.port.postMessage({
                        type: 'audio',
                        data: new Float32Array(this.buffer)
                    });
                    this.bufferIndex = 0;
                }
            }
        }
        
        return true;
    }
}

registerProcessor('vosk-audio-processor', VoskAudioProcessor);