# Spotlight

Spotlight is an AI-powered desktop search assistant for Windows, inspired by macOS Spotlight. It enables fast application launching, system-wide file search, and AI-powered interactions from a minimal interface triggered by a global hotkey.

![Platform](https://img.shields.io/badge/Platform-Windows-blue)
![Electron](https://img.shields.io/badge/Built%20with-Electron-47848F?logo=electron)
![Gemini](https://img.shields.io/badge/Powered%20by-Gemini%20AI-4285F4?logo=google)

## Features

- Instant access using a global keyboard shortcut
- Natural language commands powered by Google Gemini
- Application launching via text commands
- System-wide file and folder search
- Minimal, native-feeling Windows UI with smooth animations
- Background execution with Windows auto-start support
- Configurable AI model and user preferences

## Getting Started

### Prerequisites

- Windows 10 or Windows 11
- Node.js 18 or newer
- pnpm package manager
- Google Gemini API key

### Installation

1. Clone the repository

   ```bash
   git clone https://github.com/mianjunaid1223/Spotlight.git
   cd spotlight
   ```

2. Install dependencies

   ```bash
   pnpm install
   ```

3. Run the application

   ```bash
   pnpm start
   ```

4. Initial setup
   - Enter your Gemini API key when prompted
   - Provide a display name for personalized responses

### Building for Distribution

```bash
pnpm run build
```

The Windows installer will be generated in the `dist` directory.

## Usage

### Keyboard Shortcuts

| Shortcut        | Action                       |
| --------------- | ---------------------------- |
| Alt + Space     | Toggle Spotlight             |
| Escape          | Close Spotlight              |
| Enter           | Execute command or selection |
| Up / Down Arrow | Navigate results             |

### Example Commands

| Command            | Result                            |
| ------------------ | --------------------------------- |
| open chrome        | Launches Google Chrome            |
| launch notepad     | Opens Notepad                     |
| find my documents  | Searches for matching files       |
| where is my resume | Searches for files named "resume" |
| open settings      | Opens Windows Settings            |
| what's the weather | Responds using AI                 |

### AI Chat Mode

If a query does not match an application or file action, Spotlight automatically switches to AI chat mode and returns a conversational response powered by Gemini.

## Configuration

User settings are stored in `~/.spotlight-settings.json`:

```json
{
  "apiKey": "your-gemini-api-key",
  "modelName": "gemini-2.5-flash",
  "userName": "Your Name"
}
```

### Supported Models

- gemini-2.5-flash (default)
- gemini-2.0-flash
- gemini-2.5-pro
- gemini-3-flash-preview

## Tech Stack

- Electron for desktop application framework
- Google Generative AI (Gemini) for natural language processing
- Windows PowerShell for system-level integration
- Native Windows acrylic blur effects for UI rendering

## Project Structure

```
spotlight/
├── main.js            # Electron main process
├── preload.js         # Secure IPC bridge
├── index.html         # Main UI
├── setup.html         # First-run setup flow
├── gemini-api.js      # Gemini API integration
├── task-executor.js   # System actions and commands
└── package.json       # Project configuration
```

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a new feature branch
3. Commit your changes
4. Push to your branch
5. Open a pull request

## License

Licensed under the ISC License.

## Acknowledgments

Inspired by macOS Spotlight and Raycast. Built using Electron and Google Gemini.
