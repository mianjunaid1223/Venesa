# Venesa

<p align="center">
  <img src="assets/logo.png" alt="Venesa Logo" width="120" />
</p>

<p align="center">
  <strong>AI-Powered Voice Assistant for Windows</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-28.0-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/Gemini-2.5-4285F4?logo=google" alt="Gemini" />
  <img src="https://img.shields.io/badge/ElevenLabs-TTS%2FSTT-5436DA" alt="ElevenLabs" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## Overview

**Venesa** is a desktop voice assistant for Windows that combines wake word detection, speech recognition, and natural language processing to provide a seamless, hands-free computing experience. Speak "Hey Venesa" to activate, then ask questions, launch applications, search files, or get AI-powered responses.

### Key Features

- **Wake Word Activation** — Always-listening background detection using custom ONNX models
- **Voice Commands** — Natural speech recognition powered by ElevenLabs Scribe STT
- **AI Responses** — Intelligent conversation via Google Gemini with multi-key rotation
- **Text-to-Speech** — High-quality voice synthesis using ElevenLabs TTS
- **Quick Search Interface** — Keyboard-triggered search bar for quick text queries (Alt+Space)
- **System Integration** — Launch apps, open files, and search your Windows system
- **Screen Context** — Optional screen capture for visual context in queries

---

## Architecture

```
venesa/
├── src/
│   ├── main/                          # Electron main process
│   │   ├── main.js                    # Application entry point
│   │   └── preload/                   # Context bridge scripts
│   │       ├── main.preload.js        # Main window preload
│   │       ├── voice.preload.js       # Voice window preload
│   │       └── background.preload.js  # Background audio preload
│   ├── core/                          # Business logic services
│   │   ├── llm-service.js             # Gemini API integration
│   │   ├── elevenlabs-service.js      # TTS/STT unified service
│   │   ├── stt-service.js             # Voice activity detection
│   │   ├── task-service.js            # System actions executor
│   │   ├── wake-word-service.js       # Wake word orchestration
│   │   ├── config.js                  # ElevenLabs configuration
│   │   ├── apiKeyPool.js              # Google API key rotation
│   │   └── elevenLabsKeyPool.js       # ElevenLabs key rotation
│   └── renderer/                      # UI windows
│       ├── main.window.html           # Spotlight search interface
│       ├── voice.window.html          # Voice interaction UI
│       ├── background.window.html     # Hidden wake word listener
│       ├── setup.window.html          # First-run configuration
│       └── workers/                   # Web Workers
│           ├── audio.processor.js     # AudioWorklet processor
│           └── wake-word.worker.js    # ONNX wake word inference
├── models/                            # ONNX models for wake word
│   ├── melspectrogram.onnx
│   ├── embedding_model.onnx
│   └── hey_Venessa.onnx
├── assets/                            # Static resources
│   ├── logo.png
│   └── logo.svg
├── .env                               # API keys (not committed)
├── package.json
└── README.md
```

---

## Prerequisites

- **Operating System**: Windows 10 or Windows 11
- **Runtime**: Node.js 18.0 or higher
- **Package Manager**: pnpm (recommended) or npm
- **API Keys**:
  - Google Gemini API key(s)
  - ElevenLabs API key(s)

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/mianjunaid1223/Venesa.git
cd Venesa
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Google Gemini API Keys (supports multiple for rotation)
GOOGLE_API_KEY_1=your_gemini_api_key_here
GOOGLE_API_KEY_2=optional_second_key
GOOGLE_API_KEY_3=optional_third_key

# ElevenLabs API Keys (supports multiple for rotation)
ELEVENLABS_API_KEY_1=your_elevenlabs_api_key_here
ELEVENLABS_API_KEY_2=optional_second_key
```

### 4. Run the Application

```bash
pnpm start
```

For development with logging:

```bash
pnpm dev
```

---

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt + Space` | Toggle Venesa search bar |
| `Ctrl + Shift + V` | Open voice window manually |
| `Escape` | Close voice window |
| `Enter` | Execute selected action |
| `↑ / ↓` | Navigate search results |

### Voice Activation

Say **"Hey Venesa"** to activate voice mode. The assistant will listen for your command, process it through speech recognition, and respond with synthesized speech.

### Search Modes

| Prefix | Mode | Example |
|--------|------|---------|
| *(none)* | File/App Search | `notepad` |
| `/` | AI Query | `/what's the weather` |
| `//` | Google Search | `//latest news` |

### Voice Commands

- **"Open Chrome"** — Launches Google Chrome
- **"Find my resume"** — Searches for files matching "resume"
- **"What's on my screen?"** — Analyzes current screen content
- **"What time is it?"** — Returns current time

---

## Configuration

### Settings File

User preferences are stored in `~/.venesa-settings.json`:

```json
{
  "modelName": "gemini-2.5-flash",
  "userName": "User"
}
```

### ElevenLabs Voice

The TTS voice can be customized in `src/core/config.js`:

```javascript
tts: {
  model: 'eleven_turbo_v2_5',
  voiceId: 'pFZP5JQG7iQjIQuC4Bku',
  outputFormat: 'mp3_44100_128',
  voiceSettings: {
    stability: 0.5,
    similarity_boost: 0.75
  }
}
```

---

## API Key Rotation

Venesa supports multiple API keys for both Google Gemini and ElevenLabs. The key pool system automatically:

- Rotates through available keys
- Handles rate limits (429 errors)
- Removes invalid keys temporarily
- Provides statistics on key health

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron 28 |
| AI Model | Google Gemini 2.5 Flash |
| Speech-to-Text | ElevenLabs Scribe v1 |
| Text-to-Speech | ElevenLabs Turbo v2.5 |
| Wake Word | openWakeWord (ONNX) |
| Audio Processing | Web Audio API + AudioWorklet |
| System Integration | PowerShell (Windows Search API) |

---

## Development

### Project Scripts

```bash
pnpm start          # Launch application
pnpm dev            # Launch with verbose logging
```

### Adding New Actions

To add new system actions, modify `src/core/task-service.js`:

```javascript
async function myNewAction(params) {
  // Implementation
}

module.exports = {
  // ... existing exports
  myNewAction,
};
```

Then update the LLM prompt in `src/core/llm-service.js` to include the new action.

---

## Troubleshooting

### Wake Word Not Detecting

1. Ensure microphone permissions are granted
2. Check that ONNX models exist in the `models/` directory
3. Verify no other application is using the microphone exclusively

### STT/TTS Errors

1. Verify ElevenLabs API keys in `.env`
2. Check API key quotas on the ElevenLabs dashboard
3. Review console output for specific error codes

### Gemini API Errors

1. Verify Google API keys in `.env`
2. Ensure keys have Gemini API access enabled
3. Check for rate limiting (429 errors trigger automatic key rotation)

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Electron](https://www.electronjs.org/) — Desktop application framework
- [Google Gemini](https://ai.google.dev/) — Large language model
- [ElevenLabs](https://elevenlabs.io/) — Voice AI platform
- [openWakeWord](https://github.com/dscripka/openWakeWord) — Wake word detection

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/mianjunaid1223">mianjunaid1223</a>
</p>
