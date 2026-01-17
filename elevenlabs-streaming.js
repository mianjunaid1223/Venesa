/**
 * ElevenLabs Streaming Service
 * Uses WebSocket for real-time STT using Scribe v2
 */

const WebSocket = require('ws');
const config = require('./elevenlabs-config.js');

class ElevenLabsStreaming {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.callback = null;
    }

    start(cb) {
        this.callback = cb;
        // Using Scribe v2 Realtime as requested/implied by tutorial
        const modelId = "scribe_v2";
        const url = `wss://api.elevenlabs.io/v1/speech-to-text/stream-input?model_id=${modelId}`;

        try {
            console.log(`[ElevenLabs WS] Connecting to ${modelId}...`);
            this.ws = new WebSocket(url, {
                headers: { "xi-api-key": config.apiKey }
            });

            this.ws.on('open', () => {
                this.isConnected = true;
                console.log('[ElevenLabs WS] Connected');

                // Send initial configuration (BOS - Beginning of Stream)
                // This is critical for Scribe v2 to behave correctly
                const bosMessage = {
                    type: "start",
                    transcription_config: {
                        language_code: "en",
                        // You can add diarization or specific vocabulary here if needed
                    }
                };
                this.ws.send(JSON.stringify(bosMessage));
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    // msg structure: { type: "partial" | "final" | "error", text: "...", ... }

                    if (msg.type === 'error') {
                        console.error('[ElevenLabs WS] API Error:', msg);
                        return;
                    }

                    if (this.callback) {
                        this.callback(msg);
                    }
                } catch (e) {
                    // Sometimes pong or other binary messages might arrive, though usually JSON
                    console.error('[ElevenLabs WS] Parse error:', e);
                }
            });

            this.ws.on('error', (e) => {
                console.error('[ElevenLabs WS] Error:', e);
                this.isConnected = false;
            });

            this.ws.on('close', (code, reason) => {
                this.isConnected = false;
                console.log(`[ElevenLabs WS] Closed: ${code} - ${reason}`);
            });
        } catch (error) {
            console.error('[ElevenLabs WS] Connection failed:', error);
        }
    }

    sendAudio(buffer) {
        if (!this.isConnected || this.ws.readyState !== WebSocket.OPEN) return;

        // Convert buffer to base64
        const base64 = buffer.toString('base64');

        // Send as JSON event
        try {
            this.ws.send(JSON.stringify({
                audio_event: {
                    audio_base64: base64
                }
            }));
        } catch (error) {
            console.error('[ElevenLabs WS] Send failed:', error);
        }
    }

    stop() {
        if (this.ws) {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                // Technically we could send an EOS (End of Stream) message here, 
                // but closing the socket usually triggers finalization.
                this.ws.close();
            }
            this.ws = null;
        }
        this.isConnected = false;
    }
}

module.exports = new ElevenLabsStreaming();
