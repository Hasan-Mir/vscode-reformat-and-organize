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
        // One shared output channel for the whole session (creating a new
        // channel on every failing run leaked channels that were never disposed).
        { dispose: () => void getSessionChannel().dispose() },
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

const delay = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

let sessionChannel: vscode.OutputChannel | undefined;

/** Lazily-created, session-wide output channel (disposed on extension unload). */
function getSessionChannel(): vscode.OutputChannel {
    sessionChannel ??= vscode.window.createOutputChannel('Reformat & Organize');
    return sessionChannel;
}

async function runEntry(kind: JobKind, uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    try {
        await runEntryInner(kind, uri, uris);
    } catch (e) {
        // A deleted target, an unreadable folder etc. used to bubble up as an
        // unhandled rejection; surface it as a normal error message instead.
        void vscode.window.showErrorMessage(
            `Reformat & Organize failed: ${e instanceof Error ? e.message : String(e)}`
        );
    }
}

async function runEntryInner(kind: JobKind, uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
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

    // Import-only operations on a single file run immediately, like before.
    const shouldShowDialog =
        cfg.get<boolean>('showDialog', true) && !(!kind.format && isSingleFile);
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

    await processFiles(
        files,
        job,
        cfg.get<boolean>('saveAfterEdit', true),
        scopeName,
        getSessionChannel(),
        cfg.get<number>('organizeImportsTimeout', 10000)
    );
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
        const open = openDocumentPaths();
        files = files.filter(f => open.has(normalizeFsPath(f.fsPath)));
    }

    return files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

/**
 * Normalized paths of every document currently open in this window.
 *
 * `vscode.workspace.textDocuments` alone is NOT reliable for "which files are
 * open": it only contains documents whose text model is currently loaded in the
 * extension host, so a tab that was never activated can be missing from it —
 * which silently dropped files from the "Only open files" scope.
 * `vscode.window.tabGroups.all` enumerates ALL open editor tabs regardless of
 * whether their model is loaded; textDocuments is still unioned in as a
 * safety net (it also covers dirty documents whose tab was closed).
 */
function openDocumentPaths(): Set<string> {
    const paths = new Set<string>();

    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file') paths.add(normalizeFsPath(doc.uri.fsPath));
    }
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input;
            if (input instanceof vscode.TabInputText) {
                if (input.uri.scheme === 'file') {
                    paths.add(normalizeFsPath(input.uri.fsPath));
                }
            } else if (input instanceof vscode.TabInputTextDiff) {
                // Diff editors show two versions; the "current" one is `modified`.
                if (input.modified.scheme === 'file') {
                    paths.add(normalizeFsPath(input.modified.fsPath));
                }
            }
        }
    }
    return paths;
}

function normalizeFsPath(p: string): string {
    // Windows (and UNC) paths are case-insensitive, and the drive-letter casing
    // can differ between URIs from findFiles and URIs from open editors, so a
    // plain string comparison would miss matches on Windows.
    const normalized = p.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
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
    scopeName: string,
    channel: vscode.OutputChannel,
    organizeTimeoutMs: number
): Promise<void> {
    const verb = [job.organize ? 'Organizing imports' : '', job.format ? 'Reformatting' : '']
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
                    if (job.organize && !token.isCancellationRequested) {
                        await organizeImports(doc, organizeTimeoutMs, token);
                    }
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
async function organizeImports(
    doc: vscode.TextDocument,
    organizeTimeoutMs: number,
    token: vscode.CancellationToken
): Promise<void> {
    await withLanguageServerRetries(doc, organizeTimeoutMs, token, async () =>
        (await runSourceAction(doc, 'source.organizeImports')) === 'applied'
            ? 'applied'
            : 'retry'
    );
}

/** Languages whose servers provide import actions — everything else gets a single attempt. */
const RETRYABLE_LANGUAGE_IDS = new Set([
    'typescript',
    'javascript',
    'typescriptreact',
    'javascriptreact',
]);

/**
 * Run `attempt` until it makes progress ('applied'), proves there is nothing
 * to do ('done'), or the timeout elapses.
 *
 * Empty results ('retry') usually mean the language server hasn't finished
 * loading the project yet, so they are retried — first while the document is
 * invisible, and, after a handful of fruitless attempts, again with the
 * document briefly surfaced in a preview tab: some language servers only
 * produce code actions for documents they treat as active editors.
 */
async function withLanguageServerRetries(
    doc: vscode.TextDocument,
    timeoutMs: number,
    token: vscode.CancellationToken,
    attempt: () => Promise<'applied' | 'done' | 'retry'>
): Promise<void> {
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
    // A couple of invisible attempts first; then surface the document if the
    // server still hasn't produced anything usable.
    const maxInvisibleAttempts = RETRYABLE_LANGUAGE_IDS.has(doc.languageId) ? 6 : 1;

    const runUntilDeadline = async (): Promise<void> => {
        while (!token?.isCancellationRequested && Date.now() < deadline) {
            const outcome = await attempt();
            if (outcome !== 'retry') return;
            await delay(400);
        }
    };

    let attempts = 0;
    while (
        attempts < maxInvisibleAttempts &&
        !token?.isCancellationRequested &&
        Date.now() < deadline
    ) {
        attempts++;
        const outcome = await attempt();
        if (outcome !== 'retry') return;
        await delay(400);
    }

    if (
        token?.isCancellationRequested ||
        !RETRYABLE_LANGUAGE_IDS.has(doc.languageId) ||
        isDocumentVisible(doc) ||
        Date.now() >= deadline
    ) {
        return;
    }

    // Surface briefly so the language server treats the document like a real
    // editing session, then keep retrying until the deadline.
    try {
        await vscode.window.showTextDocument(doc, {
            preview: true,
            preserveFocus: true,
            viewColumn: vscode.ViewColumn.Beside,
        });
        await runUntilDeadline();
    } finally {
        await closeCleanPreviewTab(doc);
    }
}

function isDocumentVisible(doc: vscode.TextDocument): boolean {
    return vscode.window.visibleTextEditors.some(e => e.document.uri.toString() === doc.uri.toString());
}

/** Close the preview tab showing `doc`, but only when it has no unsaved edits. */
async function closeCleanPreviewTab(doc: vscode.TextDocument): Promise<void> {
    try {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (
                    input instanceof vscode.TabInputText &&
                    input.uri.toString() === doc.uri.toString() &&
                    !doc.isDirty
                ) {
                    await vscode.window.tabGroups.close(tab);
                    return;
                }
            }
        }
    } catch {
        // Closing is best-effort; a leftover preview tab is harmless.
    }
}

/** Apply the first available source action of `kind` to the whole document. */
async function runSourceAction(
    doc: vscode.TextDocument,
    kind: string
): Promise<'applied' | 'none'> {
    const lastLine = doc.lineAt(Math.max(0, doc.lineCount - 1));
    const fullRange = new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        doc.uri,
        fullRange,
        kind
    );
    const action = (actions ?? []).find(a => a && !a.disabled);
    if (!action) return 'none'; // language has no such source action — not an error
    await applyCodeAction(action);
    return 'applied';
}

async function applyCodeAction(action: vscode.CodeAction): Promise<void> {
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
