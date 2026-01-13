// Wake Word Detection Service - Reuses main Vosk worker for background listening
const { spawn } = require('child_process');
const path = require('path');

// Wake words to detect (Venesa variations)
const WAKE_WORDS = ['venesa', 'vanessa', 'vinessa', 'benessa', 'hey venesa', 'hey vanessa'];

class WakeWordService {
    constructor() {
        this.worker = null;
        this.isRunning = false;
        this.isPaused = false;  // Separate pause flag
        this.onWakeWord = null;
        this.lastWakeTime = 0;
        this.cooldownMs = 5000; // 5 second cooldown to prevent duplicate triggers
    }

    start(callback) {
        if (this.worker) return;

        this.onWakeWord = callback;

        // Spawn the unified Vosk worker (same as voice STT)
        this.worker = spawn('node', [path.join(__dirname, 'vosk-worker.js')], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false
        });

        this.worker.stdout.setEncoding('utf8');
        this.worker.stdout.on('data', (data) => {
            const lines = data.split('\n').filter(line => line.trim());
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    // Only check final results, not partials (prevents multiple triggers)
                    if (msg.type === 'result' && !this.isPaused) {
                        this.checkForWakeWord(msg.text);
                    } else if (msg.type === 'status' && msg.status === 'ready') {
                        this.isRunning = true;
                    }
                } catch (e) {
                    // Ignore non-JSON output
                }
            }
        });

        this.worker.stderr.on('data', (data) => {
            // Suppress stderr for cleaner logs
        });

        this.worker.on('close', (code) => {
            console.log('Wake word worker exited:', code);
            this.worker = null;
            this.isRunning = false;

            // Auto-restart after 2 seconds if it crashes
            if (code !== 0) {
                setTimeout(() => this.start(this.onWakeWord), 2000);
            }
        });

        this.worker.on('error', (err) => {
            console.error('Wake word worker error:', err);
            this.worker = null;
        });
    }

    checkForWakeWord(text) {
        if (!text) return;

        const now = Date.now();
        if (now - this.lastWakeTime < this.cooldownMs) return;

        const lowerText = text.toLowerCase();

        for (const word of WAKE_WORDS) {
            if (lowerText.includes(word)) {
                this.lastWakeTime = now;
                console.log(`[WakeWord] Detected: "${word}"`);
                if (this.onWakeWord) {
                    this.onWakeWord(word);
                }
                return;
            }
        }
    }

    feedAudio(audioData) {
        if (this.worker && this.isRunning) {
            this.worker.stdin.write(audioData);
        }
    }

    pause() {
        this.isPaused = true;
        this.lastWakeTime = Date.now(); // Reset cooldown timer
    }

    resume() {
        // Instant resume - cooldown protection handled by lastWakeTime check
        this.isPaused = false;
    }

    stop() {
        if (this.worker) {
            this.worker.stdin.end();
            this.worker.kill();
            this.worker = null;
            this.isRunning = false;
        }
    }
}

module.exports = new WakeWordService();
