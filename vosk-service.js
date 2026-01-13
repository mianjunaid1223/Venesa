const { spawn } = require('child_process');
const path = require('path');

class VoskService {
    constructor() {
        this.worker = null;
        this.callback = null;
        this.isListening = false;
        this.isWorkerReady = false;
    }

    initialize() {
        if (this.worker) return; // Already initialized

        // Spawn a child process using system Node.js (not Electron's Node)
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
                    if (msg.type === 'result' && this.callback && this.isListening) {
                        this.callback('text', msg.text);
                    } else if (msg.type === 'partial' && this.callback && this.isListening) {
                        this.callback('partial', msg.text);
                    } else if (msg.type === 'status') {
                        if (msg.status === 'ready') {
                            this.isWorkerReady = true;
                            // Notify that Vosk is ready
                            if (this.callback && this.isListening) {
                                this.callback('ready', null);
                            }
                        }
                    } else if (msg.error) {
                        console.error('Vosk worker error:', msg.error);
                    }
                } catch (e) {
                    // Ignore non-JSON output
                }
            }
        });

        this.worker.stderr.on('data', (data) => {
            console.error('Vosk worker stderr:', data.toString());
        });

        this.worker.on('close', (code) => {
            // Only log if not intentionally terminated
            if (code !== null && code !== 0) {
                console.log('Vosk worker exited unexpectedly with code:', code);
            }
            this.worker = null;
            this.isListening = false;
            this.isWorkerReady = false;
        });

        this.worker.on('error', (err) => {
            console.error('Failed to start Vosk worker:', err);
            this.worker = null;
            this.isWorkerReady = false;
        });
    }

    // Start listening (reuse existing worker)
    start(onResult) {
        this.callback = onResult;

        // Initialize worker if not already done
        if (!this.worker) {
            this.initialize();
        }

        this.isListening = true;

        // If worker is already ready, no callback needed - renderer can start immediately
        // The 'ready' callback is only sent during initial initialization
    }

    // Feed audio data from renderer process
    feedAudio(audioData) {
        if (this.worker && this.isListening && this.isWorkerReady) {
            // audioData is a Buffer of PCM 16-bit mono audio at 16kHz
            this.worker.stdin.write(audioData);
        }
    }

    // Pause listening (keep worker alive)
    pause() {
        this.isListening = false;
        // Worker stays alive, just stop processing audio
    }

    // Stop and destroy worker completely
    stop() {
        this.isListening = false;
        // Don't destroy the worker - just pause it for fast restart
        // Use shutdown() only when app is closing
    }

    // Complete shutdown (only on app exit)
    shutdown() {
        this.isListening = false;
        if (this.worker) {
            try {
                this.worker.stdin.end();
                this.worker.kill('SIGTERM');
            } catch (err) {
                console.error('Error stopping Vosk worker:', err);
            }
            this.worker = null;
        }
        this.callback = null;
        this.isWorkerReady = false;
    }

    free() {
        this.shutdown();
    }
}

module.exports = new VoskService();
