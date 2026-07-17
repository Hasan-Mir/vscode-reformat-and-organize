# Reformat & Organize

> **Organize Imports & Format Files** directly from the VS Code Explorer. ✨

Process a file, folder, or Explorer multi-selection in the background without opening every file in an editor tab.

## Features

- Separate **Reformat Code…** and **Organize Imports…** commands
- Theme-aware icons in Explorer and editor context menus
- Single-file Organize Imports runs immediately
- Folder and multi-selection dialogs support **Only changed files** and **Only open files**
- Reformat Code can optionally optimize imports
- WebStorm-style file masks

## Scope filters

**Only open files** is available for both Reformat Code and Organize Imports. When combined with **Only changed files**, a document must match both filters.

## Development

```bash
npm install
npm run build
npm test
```
