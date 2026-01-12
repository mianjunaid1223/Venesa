// Background Audio Capture Service - Low-resource microphone listener
const { spawn } = require('child_process');
const path = require('path');

class BackgroundAudioService {
    constructor() {
        this.isCapturing = false;
        this.audioCallback = null;
        this.captureProcess = null;
    }

    // Start background audio capture using system mic
    // This runs in a separate process to be lightweight
    async start(onAudioData) {
        if (this.isCapturing) return;

        this.audioCallback = onAudioData;
        this.isCapturing = true;

        // Use PowerShell to capture audio via Windows APIs
        // This is more efficient than Web Audio API in background
        const scriptPath = path.join(__dirname, 'audio-capture.ps1');

        // For now, we'll use a Node.js approach with node-record-lpcm16
        // But since it requires native modules, we'll signal the renderer to capture
        console.log('Background audio service started');
    }

    stop() {
        this.isCapturing = false;
        if (this.captureProcess) {
            this.captureProcess.kill();
            this.captureProcess = null;
        }
    }

    feedAudio(audioData) {
        if (this.audioCallback && this.isCapturing) {
            this.audioCallback(audioData);
        }
    }
}

module.exports = new BackgroundAudioService();
