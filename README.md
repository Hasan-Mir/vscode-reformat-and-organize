# 🔄 Reformat & Organize

> **Organize Imports & Format Files** directly from the VS Code Explorer or editor tabs. ✨

Process a file, folder, editor tab, or any multi-selection in the background—without opening every file in an editor tab.

## ✨ Features

- 🧹 Separate **Reformat Code…** and **Organize Imports…** commands
- ⚡ Run **Organize Imports** immediately for a single file
- 📂 Process folders and Explorer multi-selections
- 🗂️ Right-click **editor tabs** (single or multi-selected) and process them directly
- 🗃️ Multi-select files in the **Open Editors** view and process them
- 🌿 Filter files using **Only changed files**
- 📖 Filter files using **Only open files**
- 🔗 Optionally organize imports while running **Reformat Code**
- 🎯 Filter the scope with WebStorm-style file masks
- 🖥️ Process files quietly in the background without opening editor tabs

## 🖥️ Editor Tabs & Open Editors

Both commands are available when you right-click a tab in the tab bar, and in the context menu of the **Open Editors** view:

- **📐 Reformat Code…**
- **🧹 Organize Imports…**

Select one or more tabs (Ctrl/Cmd+click), right-click and pick a command—the selected files are processed directly, no need to find them in the Explorer.

> Tip: for many tabs at once, multi-select files in the **Open Editors** view (bottom of the Explorer sidebar) or use the *Only open files* scope filter instead.

## 🔍 Scope Filters

Both **Reformat Code** and **Organize Imports** support scope filtering when processing folders or Explorer multi-selections.

### 🌿 Only changed files

Processes only files reported as changed by Git, including:

- Staged files
- Unstaged files
- Renamed files
- Untracked files

Deleted files are automatically skipped.

### 📖 Only open files

Processes only documents currently open in the active VS Code window.

When **Only changed files** and **Only open files** are enabled together, a document must match both filters to be processed.

### 🎯 File masks

Use WebStorm-style masks to limit which files are processed:

```text
*.ts, *.tsx
src/**/*.js
*.vue; *.json
```

Supported patterns:

- `*` matches characters within one path segment
- `?` matches a single character
- `**` matches across path segments

## 🧹 Reformat Code

Right-click a file, folder, editor tab, or any selection (Explorer / Open Editors / tab bar) and choose **Reformat Code…**.

You can optionally:

- Optimize imports before formatting
- Process only Git-changed files
- Process only open files
- Filter files using file masks

## 📦 Organize Imports

Right-click a file, folder, editor tab, or any selection (Explorer / Open Editors / tab bar) and choose **Organize Imports…**.

- A single selected file is processed immediately.
- Folders and multi-selections display the scope filters.
- Languages without an Organize Imports provider are skipped without stopping the remaining operation.

## ⚙️ Requirements

- **VS Code 1.85.0 or newer** — the extension only relies on long-stable APIs (`window.tabGroups` requires VS Code 1.67+), so it works on the current release as well as many older versions.

## 🔧 Configuration

All settings live under the `reformatAndOrganize.` prefix:

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `include` | string | `*.ts, *.tsx, *.js, *.jsx, *.mjs, *.cjs, *.vue, *.json, *.jsonc, *.css, *.scss, *.less, *.html` | Default file mask(s) used by the scope dialog (comma-separated, WebStorm style). Supports `*`, `?` and `**`. |
| `exclude` | array | `**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/out/**`, `**/build/**`, `**/coverage/**`, `**/.next/**`, `**/*.min.*` | Glob patterns that are always skipped, even when a folder is right-clicked directly. |
| `showDialog` | boolean | `true` | Show the WebStorm-like scope dialog (options + file mask) before running. |
| `organizeImportsDuringFormat` | boolean | `false` | Default state of the **Optimize imports** checkbox in the dialog. |
| `saveAfterEdit` | boolean | `true` | Save each file after it has been processed in the background. When disabled, changed files are left dirty so you can review them. |
| `organizeImportsTimeout` | number | `0` | Maximum time in **milliseconds** to wait for the language server to load & analyze a background-opened file before running **Organize Imports**. By default (`0`) the extension waits **as long as it takes**; the progress notification's cancel button always aborts. |
