import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parsePorcelainZ } from './core/git';
import { isExcluded, matchesMasks, parseMasks } from './core/mask';

interface JobKind {
    format: boolean;
    organize: boolean;
}

interface DialogResult {
    organize: boolean;
    format: boolean;
    changedOnly: boolean;
    openOnly: boolean;
    masks: string[];
}

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'reformatAndOrganize.reformatCode',
            (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
                runEntry({ format: true, organize: false }, uri, uris)
        ),
        vscode.commands.registerCommand(
            'reformatAndOrganize.organizeImports',
            (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
                runEntry({ format: false, organize: true }, uri, uris)
        )
    );
}

export function deactivate(): void {}

async function runEntry(kind: JobKind, uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('reformatAndOrganize');

    // Targets: multi-select in the Explorer, a single file/folder, the active
    // editor's file, or the first workspace folder as a fallback.
    let targets = (uris && uris.length > 0 ? uris : uri ? [uri] : []).filter(
        u => u && u.scheme === 'file'
    );
    if (targets.length === 0 && vscode.window.activeTextEditor) {
        targets = [vscode.window.activeTextEditor.document.uri];
    }
    if (targets.length === 0) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            void vscode.window.showWarningMessage(
                'Open a folder or right-click a file/folder in the Explorer first.'
            );
            return;
        }
        targets = [folders[0].uri];
    }

    const stats = await Promise.all(targets.map(target => vscode.workspace.fs.stat(target)));
    const isSingleFile = targets.length === 1 && (stats[0].type & vscode.FileType.Directory) === 0;

    const scopeName =
        targets.length === 1
            ? path.basename(targets[0].fsPath)
            : `${targets.length} selected items`;

    let job: DialogResult = {
        format: kind.format,
        organize:
            kind.organize ||
            (kind.format && cfg.get<boolean>('organizeImportsDuringFormat', false)),
        changedOnly: false,
        openOnly: false,
        masks: parseMasks(cfg.get<string>('include', '')),
    };

    const shouldShowDialog =
        cfg.get<boolean>('showDialog', true) && !(kind.organize && !kind.format && isSingleFile);
    if (shouldShowDialog) {
        const fromDialog = await showScopeDialog(kind, scopeName, cfg);
        if (!fromDialog) return; // cancelled
        job = fromDialog;
    }

    const excludes = cfg.get<string[]>('exclude', []);
    const files = await collectFiles(targets, job.masks, excludes, job.changedOnly, job.openOnly);
    if (files.length === 0) {
        void vscode.window.showInformationMessage(`No matching files found in ${scopeName}.`);
        return;
    }

    await processFiles(files, job, cfg.get<boolean>('saveAfterEdit', true), scopeName);
}

/**
 * WebStorm-like scope dialog:
 *  step 1 — checkboxes (Optimize imports / Only changed files / Only open files), like the
 *           checkboxes in WebStorm's "Reformat Code" dialog;
 *  step 2 — file mask input, like WebStorm's "Filters" scope.
 */
async function showScopeDialog(
    kind: JobKind,
    scopeName: string,
    cfg: vscode.WorkspaceConfiguration
): Promise<DialogResult | undefined> {
    const OPTIMIZE = '$(references) Optimize imports';
    const CHANGED = '$(git-branch) Only changed files';
    const OPEN = '$(files) Only open files';

    const items: vscode.QuickPickItem[] = [];
    if (kind.format) {
        items.push({
            label: OPTIMIZE,
            detail: "Also run Organize Imports on every file (WebStorm's checkbox in the Reformat Code dialog).",
            picked: cfg.get<boolean>('organizeImportsDuringFormat', false),
        });
    }
    items.push({
        label: CHANGED,
        detail: 'Only process files reported as changed by Git (staged, unstaged and untracked).',
        picked: false,
    });
    items.push({
        label: OPEN,
        detail: 'Only process files already open in this VS Code window.',
        picked: false,
    });

    const picked = (await vscode.window.showQuickPick(items, {
        title: kind.format ? `Reformat Code: ${scopeName}` : `Organize Imports: ${scopeName}`,
        placeHolder: 'Options — Space to toggle, Enter to continue, Esc to cancel',
        canPickMany: true,
        ignoreFocusOut: true,
    })) as vscode.QuickPickItem[] | undefined;
    if (!picked) return undefined;

    const mask = await vscode.window.showInputBox({
        title: `File mask(s) — ${scopeName}`,
        prompt: 'Comma-separated masks like `*.ts, *.tsx`. Leave empty to include all files.',
        value: cfg.get<string>('include', ''),
        ignoreFocusOut: true,
    });
    if (mask === undefined) return undefined; // cancelled

    return {
        format: kind.format,
        organize: kind.organize || picked.some(p => p.label === OPTIMIZE),
        changedOnly: picked.some(p => p.label === CHANGED),
        openOnly: picked.some(p => p.label === OPEN),
        masks: parseMasks(mask),
    };
}

async function collectFiles(
    targets: vscode.Uri[],
    masks: string[],
    excludes: string[],
    changedOnly: boolean,
    openOnly: boolean
): Promise<vscode.Uri[]> {
    const byPath = new Map<string, vscode.Uri>();
    for (const target of targets) {
        const stat = await vscode.workspace.fs.stat(target);
        if (stat.type & vscode.FileType.Directory) {
            const excludeGlob = excludes.length > 0 ? `{${excludes.join(',')}}` : undefined;
            const found = await vscode.workspace.findFiles(
                new vscode.RelativePattern(target, '**/*'),
                excludeGlob ?? null
            );
            for (const f of found) byPath.set(f.fsPath, f);
        } else {
            byPath.set(target.fsPath, target);
        }
    }

    let files = [...byPath.values()].filter(f => {
        const rel = vscode.workspace.asRelativePath(f, false).replace(/\\/g, '/');
        return matchesMasks(rel, masks) && !isExcluded(rel, excludes);
    });

    if (changedOnly) {
        const changed = await gitChangedFiles(targets);
        files = files.filter(f => changed.has(normalizeFsPath(f.fsPath)));
    }

    if (openOnly) {
        const open = new Set(
            vscode.workspace.textDocuments
                .filter(d => d.uri.scheme === 'file' && !d.isClosed)
                .map(d => normalizeFsPath(d.uri.fsPath))
        );
        files = files.filter(f => open.has(normalizeFsPath(f.fsPath)));
    }

    return files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

function normalizeFsPath(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Absolute paths of all git-changed files in the repos of the given targets. */
async function gitChangedFiles(targets: vscode.Uri[]): Promise<Set<string>> {
    const roots = new Set<string>();
    for (const t of targets) {
        const folder =
            vscode.workspace.getWorkspaceFolder(t) ?? vscode.workspace.workspaceFolders?.[0];
        if (folder) roots.add(folder.uri.fsPath);
    }

    const changed = new Set<string>();
    for (const root of roots) {
        const output = await new Promise<string>(resolve => {
            cp.execFile(
                'git',
                ['-C', root, 'status', '--porcelain=v1', '-z'],
                { maxBuffer: 64 * 1024 * 1024 },
                (error, stdout) => resolve(error ? '' : stdout)
            );
        });
        for (const rel of parsePorcelainZ(output)) {
            changed.add(normalizeFsPath(path.join(root, rel)));
        }
    }
    return changed;
}

async function processFiles(
    files: vscode.Uri[],
    job: DialogResult,
    saveAfterEdit: boolean,
    scopeName: string
): Promise<void> {
    const verb = [job.format ? 'Reformatting' : '', job.organize ? 'Organizing imports' : '']
        .filter(Boolean)
        .join(' + ');
    const errors: string[] = [];
    let processed = 0;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `${verb}: ${scopeName} (${files.length} files)`,
            cancellable: true,
        },
        async (progress, token) => {
            for (const file of files) {
                if (token.isCancellationRequested) break;
                const rel = vscode.workspace.asRelativePath(file, false);
                progress.report({ message: rel, increment: 100 / files.length });
                try {
                    // openTextDocument loads the file in the BACKGROUND — no editor
                    // tab is opened and nothing flashes on screen.
                    const doc = await vscode.workspace.openTextDocument(file);
                    if (job.organize) await organizeImports(doc);
                    if (job.format) await formatDocument(doc);
                    if (saveAfterEdit && doc.isDirty) await doc.save();
                    processed++;
                } catch (e) {
                    errors.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
    );

    if (errors.length > 0) {
        const channel = vscode.window.createOutputChannel('Reformat & Organize');
        for (const err of errors) channel.appendLine(err);
        channel.show(true);
        void vscode.window.showWarningMessage(
            `Done: ${processed}/${files.length} files processed, ${errors.length} failed (see Output panel).`
        );
    } else {
        void vscode.window.showInformationMessage(
            `Done: ${processed}/${files.length} files processed.`
        );
    }
}

/** Run the "source.organizeImports" code action on a document, in the background. */
async function organizeImports(doc: vscode.TextDocument): Promise<void> {
    const lastLine = doc.lineAt(Math.max(0, doc.lineCount - 1));
    const fullRange = new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
    const actions = await vscode.commands.executeCommand<any[]>(
        'vscode.executeCodeActionProvider',
        doc.uri,
        fullRange,
        'source.organizeImports'
    );
    const action = (actions ?? []).find(a => a && !a.disabled);
    if (!action) return; // language has no organize-imports support — not an error
    if (action.edit) await vscode.workspace.applyEdit(action.edit);
    if (action.command) {
        await vscode.commands.executeCommand(
            action.command.command,
            ...(action.command.arguments ?? [])
        );
    }
}

/** Format a document in the background using its registered formatter. */
async function formatDocument(doc: vscode.TextDocument): Promise<void> {
    const editorCfg = vscode.workspace.getConfiguration('editor', doc.uri);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
        'vscode.executeFormatDocumentProvider',
        doc.uri,
        {
            tabSize: editorCfg.get<number>('tabSize', 4),
            insertSpaces: editorCfg.get<boolean>('insertSpaces', true),
        }
    );
    if (edits && edits.length > 0) {
        const we = new vscode.WorkspaceEdit();
        we.set(doc.uri, edits);
        await vscode.workspace.applyEdit(we);
    }
}
