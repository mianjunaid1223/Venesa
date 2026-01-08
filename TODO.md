# Vecta Upgrade TODO

1. Refactor command pipeline for unified text/voice input and local rule book.
2. Upgrade UI: bottom input bar (gradient, shadow, instant pop-up), full-screen voice overlay (wave animation, dimming, selection border).
3. Implement lightweight wake-word detection process.
4. Add system command handlers: open apps, files, folders, URLs, YouTube, Google search.
5. Integrate Google iframe and YouTube playback.
6. Add screen capture/encircle overlay logic (transparent selection, dimmed background, border highlight).
7. Modularize STT/TTS/Gemini calls for on-demand spawning.
8. Integrate fast, local file indexing (FlexSearch or custom Node.js) for context-based file search.
9. Expose file search API to command pipeline and UI.
10. Optimize for RAM/CPU usage (<50 MB idle, GPU-accelerated overlays/animations).
11. Prepare for Microsoft Store release (code signing, installer, privacy, telemetry opt-in).

---

- Each step should be modular and maintainable.
- Prioritize local-first, low-resource, and premium UX.
- No user-provided API keys; app manages Gemini key securely.
- Indexing must be incremental and low-impact.
