// Piper TTS Service - Uses Piper for offline text-to-speech
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PIPER_PATH = path.join(__dirname, 'piper', 'piper', 'piper.exe');
const MODEL_PATH = path.join(__dirname, 'piper', 'piper', 'en_US-hfc_female-medium.onnx');

class PiperService {
    constructor() {
        this.isReady = fs.existsSync(PIPER_PATH) && fs.existsSync(MODEL_PATH);
    }

    /**
     * Synthesize text to speech and return the audio file path
     * @param {string} text - Text to synthesize
     * @returns {Promise<string>} - Path to the generated WAV file
     */
    async synthesize(text) {
        if (!this.isReady) {
            throw new Error('Piper TTS not available');
        }

        // Create temp file for output
        const tempDir = os.tmpdir();
        const outputPath = path.join(tempDir, `venesa_tts_${Date.now()}.wav`);

        return new Promise((resolve, reject) => {
            // Optimized for speed: lower quality but 2-3x faster
            const piper = spawn(PIPER_PATH, [
                '--model', MODEL_PATH,
                '--output_file', outputPath,
                '--length_scale', '0.9',  // Slightly faster speech (0.9 = 10% faster)
                '--noise_scale', '0.5',   // Less variability = faster generation
                '--noise_w', '0.5'        // Less phoneme variation = faster
            ], {
                stdio: ['pipe', 'ignore', 'ignore'], // Ignore stderr/stdout for speed
                windowsHide: true
            });

            piper.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    resolve(outputPath);
                } else {
                    reject(new Error(`Piper TTS failed`));
                }
            });

            piper.on('error', (err) => {
                reject(err);
            });

            // Send text to stdin
            piper.stdin.write(text);
            piper.stdin.end();
        });
    }

    /**
     * Synthesize text and return as base64 data URL for browser playback
     * @param {string} text - Text to synthesize
     * @returns {Promise<string>} - Base64 data URL of the audio
     */
    async synthesizeToDataURL(text) {
        const wavPath = await this.synthesize(text);
        const buffer = fs.readFileSync(wavPath);
        const base64 = buffer.toString('base64');

        // Clean up temp file immediately
        try {
            fs.unlinkSync(wavPath);
        } catch (e) {
            // Ignore cleanup errors
        }

        return `data:audio/wav;base64,${base64}`;
    }

    isAvailable() {
        return this.isReady;
    }
}

module.exports = new PiperService();
