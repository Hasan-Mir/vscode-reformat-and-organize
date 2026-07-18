# 🔄 Reformat & Organize

> **Organize Imports & Format Files** directly from the VS Code Explorer. ✨

Process a file, folder, or Explorer multi-selection in the background—without opening every file in an editor tab.

## ✨ Features

- 🧹 Separate **Reformat Code…** and **Organize Imports…** commands
- ⚡ Run **Organize Imports** immediately for a single file
- 📂 Process folders and Explorer multi-selections
- 🌿 Filter files using **Only changed files**
- 📖 Filter files using **Only open files**
- 🔗 Optionally organize imports while running **Reformat Code**
- 🎯 Filter the scope with WebStorm-style file masks
- 🖥️ Process files quietly in the background without opening editor tabs

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

_.ts,_ .tsx

src//\*.js

_.vue;_ .json

Supported patterns:

- `*` matches characters within one path segment
- `?` matches a single character
- `**` matches across path segments

## 🧹 Reformat Code

Right-click a file, folder, or Explorer selection and choose **Reformat Code…**.

You can optionally:

- Optimize imports before formatting
- Process only Git-changed files
- Process only open files
- Filter files using file masks

## 📦 Organize Imports

Right-click a file, folder, or Explorer selection and choose **Organize Imports…**.

- A single selected file is processed immediately.
- Folders and multi-selections display the scope filters.
- Languages without an Organize Imports provider are skipped without stopping the remaining operation.
