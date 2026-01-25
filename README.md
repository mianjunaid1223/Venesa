# Venesa

<p align="center">
  <img src="assets/logo.png" alt="Venesa Logo" width="120" />
</p>

<p align="center">
  <strong>Voice Assistant for Windows</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-28.0-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/Gemini-2.5-4285F4?logo=google" alt="Gemini" />
  <img src="https://img.shields.io/badge/ElevenLabs-TTS%2FSTT-5436DA" alt="ElevenLabs" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## What is Venesa?

Venesa is a desktop voice assistant for Windows. It listens for the wake word "Hey Venesa", transcribes your speech, processes it with Google Gemini, and responds with synthesized voice. You can also use it through a keyboard-triggered search bar.

**What it does:**

- Listens in the background for the wake word using ONNX-based detection
- Transcribes speech using ElevenLabs Scribe
- Processes queries with Google Gemini 2.5
- Speaks responses using ElevenLabs text-to-speech
- Searches files and launches applications on your system
- Provides a quick-access search bar (Alt+Space)

---

## Project Structure

```
venesa/
├── src/
│   ├── main/
│   │   ├── main.js                    # Electron main process
│   │   └── preload/
│   │       ├── main.preload.js
│   │       ├── voice.preload.js
│   │       └── background.preload.js
│   ├── core/
│   │   ├── llm-service.js             # Gemini API calls
│   │   ├── elevenlabs-service.js      # TTS and STT
│   │   ├── stt-service.js             # Voice activity detection
│   │   ├── task-service.js            # System actions (open apps, search files)
│   │   ├── wake-word-service.js       # Wake word detection setup
│   │   ├── config.js                  # ElevenLabs settings
│   │   ├── apiKeyPool.js              # Google API key rotation
│   │   └── elevenLabsKeyPool.js       # ElevenLabs key rotation
│   └── renderer/
│       ├── main.window.html           # Search bar UI
│       ├── voice.window.html          # Voice interaction UI
│       ├── background.window.html     # Background wake word listener
│       ├── setup.window.html          # First-run setup
│       └── workers/
│           ├── audio.processor.js     # Audio processing worklet
│           └── wake-word.worker.js    # ONNX inference worker
├── models/
│   ├── melspectrogram.onnx            # Converts audio to mel spectrogram
│   ├── embedding_model.onnx           # Generates audio embeddings
│   ├── hey_vuh_ness_uh.onnx               # Wake word classifier
│   └── hey_Venessa.tflite             # Alternative wake word model
├── assets/
│   └── logo.png
├── .env                               # API keys (not in git)
├── package.json
└── README.md


## Requirements

- Windows 10 or 11
- Node.js 18 or higher
- pnpm
- Google Gemini API key
- ElevenLabs API key

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/mianjunaid1223/Venesa.git
cd Venesa
pnpm install
```

### 2. Add API keys

Create a `.env` file in the project root:

```env
# Google Gemini API keys (add multiple for rotation)
GOOGLE_API_KEY_1=your_key_here
GOOGLE_API_KEY_2=optional_second_key
GOOGLE_API_KEY_3=optional_third_key

# ElevenLabs API keys (add multiple for rotation)
ELEVENLABS_API_KEY_1=your_key_here
ELEVENLABS_API_KEY_2=optional_second_key
```

### 3. Run

```bash
pnpm start
```

For debug logging:

```bash
pnpm dev
```

---

## How to Use

### Keyboard Shortcuts

| Shortcut | What it does |
|----------|--------------|
| `Alt + Space` | Open/close search bar |
| `Ctrl + Shift + V` | Open voice window |
| `Escape` | Close current window |
| `Enter` | Run selected action |
| `↑ / ↓` | Navigate results |

### Voice Mode

Say "Hey Venesa" to activate. The app will:
1. Show a listening indicator
2. Record and transcribe your speech
3. Send it to Gemini for processing
4. Speak the response

### Search Bar Modes

| Prefix | Mode | Example |
|--------|------|---------|
| *(none)* | Search files and apps | `notepad` |
| `/` | Ask Gemini | `/how do I resize an image` |
| `//` | Google search | `//weather today` |

### Example Commands

- "Open Chrome"
- "Find documents with budget"
- "What time is it?"
- "Set volume to 50%"
- "What's on my screen?" (captures and analyzes screen)

---

## Configuration

Settings are stored in `~/.venesa-settings.json`:

```json
{
  "modelName": "gemini-2.5-flash",
  "userName": "User"
}
```

You can also change settings through the gear icon in the search bar.

### Voice Settings

Edit `src/core/config.js` to change the TTS voice:

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

Both Google and ElevenLabs support multiple keys. The app automatically:

- Rotates between available keys
- Switches keys when rate limited (429 errors)
- Skips keys that return errors

Add keys with incrementing numbers: `GOOGLE_API_KEY_1`, `GOOGLE_API_KEY_2`, etc.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop framework | Electron 28 |
| Language model | Google Gemini 2.5 Flash |
| Speech-to-text | ElevenLabs Scribe |
| Text-to-speech | ElevenLabs Turbo v2.5 |
| Wake word | openWakeWord (ONNX) |
| Audio | Web Audio API, AudioWorklet |
| System integration | PowerShell |

---

## Adding New Actions

Edit `src/core/task-service.js` to add system actions:

```javascript
async function myAction(params) {
  // your code here
}

module.exports = {
  // existing exports...
  myAction,
};
```

Then update the prompt in `src/core/llm-service.js` so Gemini knows about the new action.

---

## Troubleshooting

### Wake word not working

1. Check microphone permissions in Windows Settings
2. Make sure model files exist in `models/`
3. Close other apps that might be using the microphone
4. Restart the app

### Speech-to-text or text-to-speech errors

1. Check your ElevenLabs API key in `.env`
2. Check your quota at [elevenlabs.io/app](https://elevenlabs.io/app)
3. Run with `pnpm dev` to see error details

### Gemini errors

1. Check your Google API key in `.env`
2. Make sure the key has Gemini API access enabled
3. If you see 429 errors, add more keys for rotation

### Voice window not responding

1. Press Escape to close, then Ctrl+Shift+V to reopen
2. Check console for errors with `pnpm dev`

---

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push (`git push origin my-feature`)
5. Open a pull request

---

## License

MIT License. See [LICENSE](LICENSE).

---

## Credits

- [Electron](https://www.electronjs.org/)
- [Google Gemini](https://ai.google.dev/)
- [ElevenLabs](https://elevenlabs.io/)
- [openWakeWord](https://github.com/dscripka/openWakeWord)
- [ONNX Runtime](https://onnxruntime.ai/)

---

<p align="center">
  Made by <a href="https://github.com/mianjunaid1223">mianjunaid1223</a>
</p>
