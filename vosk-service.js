const { spawn } = require('child_process');
const path = require('path');

class VoskService {
    constructor() {
        this.worker = null;
        this.callback = null;
        this.isListening = false;
    }

    start(onResult) {
        if (this.worker) return;

        this.callback = onResult;

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
                    if (msg.type === 'result' && this.callback) {
                        this.callback('text', msg.text);
                    } else if (msg.type === 'partial' && this.callback) {
                        this.callback('partial', msg.text);
                    } else if (msg.type === 'status') {
                        console.log('Vosk worker status:', msg.status);
                        if (msg.status === 'ready') {
                            this.isListening = true;
                            // Notify main process that Vosk is ready
                            if (this.callback) {
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
            console.log('Vosk worker exited with code:', code);
            this.worker = null;
            this.isListening = false;
        });

        this.worker.on('error', (err) => {
            console.error('Failed to start Vosk worker:', err);
            this.worker = null;
        });
    }

    // Feed audio data from renderer process
    feedAudio(audioData) {
        if (this.worker && this.isListening) {
            // audioData is a Buffer of PCM 16-bit mono audio at 16kHz
            this.worker.stdin.write(audioData);
        }
    }

    stop() {
        this.isListening = false;
    }

    free() {
        if (this.worker) {
            this.worker.stdin.end();
            this.worker.kill();
            this.worker = null;
            this.isListening = false;
        }
    }
}

module.exports = new VoskService();
