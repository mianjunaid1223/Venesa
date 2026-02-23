# Venesa Plugins

This directory contains external skills and plugins for Venesa. 
Any `.js` file or folder containing a `skill.js` file dropped here will be automatically discovered and loaded when you restart Venesa or use a command that reloads skills.

## Creating a Plugin
Each plugin must export an object following the unified skill architecture.
See `sample-plugin.js` for a working example.

### Key Fields:
- `name`: Unique identifier for your skill.
- `description`: A short explanation of what your skill does.
- `trigger`: (Optional) Quick trigger keyword to bypass the LLM.
- `execute(query, context)`: The main logic function. Must return a structured result.
- `ui`: (Optional) Set to a custom component name (e.g., `cardList`) to render the result dynamically in the main window.
