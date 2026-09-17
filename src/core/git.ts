/**
 * Parsing of `git status --porcelain=v1 -z` output (pure function — unit tested).
 */

/**
 * Returns repo-relative paths of files that are changed in the working tree or
 * index (staged, unstaged and untracked). Deleted files are skipped because
 * they cannot be formatted. For renames/copies the NEW path is returned.
 */
export function parsePorcelainZ(output: string): string[] {
    const entries = output.split('\0').filter(e => e.length > 0);
    const files: string[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.length < 4) continue;
        const status = entry.slice(0, 2);
        const filePath = entry.slice(3);
        const isRenameOrCopy = status[0] === 'R' || status[0] === 'C';
        // In -z mode a rename/copy entry is followed by a second NUL-separated
        // record containing the ORIGINAL path — skip it.
        if (isRenameOrCopy) i++;
        if (status.includes('D')) continue;
        files.push(filePath);
    }
    return files;
}

/**
 * Returns repo-relative paths of files staged in the Git index (staged modifications,
 * additions, renames, and copies). Unstaged, untracked, and deleted files are skipped.
 */
export function parseStagedPorcelainZ(output: string): string[] {
    const entries = output.split('\0').filter(e => e.length > 0);
    const files: string[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.length < 4) {
            continue;
        }
        const status = entry.slice(0, 2);
        const filePath = entry.slice(3);
        const isRenameOrCopy = status[0] === 'R' || status[0] === 'C';
        if (isRenameOrCopy) {
            i++;
        }
        if (status.includes('D')) {
            continue;
        }
        const indexStatus = status[0];
        if (
            indexStatus === 'M' ||
            indexStatus === 'A' ||
            indexStatus === 'R' ||
            indexStatus === 'C'
        ) {
            files.push(filePath);
        }
    }
    return files;
}

/**
 * Returns repo-relative paths of files that have non-staged working-tree
 * changes. Untracked files are included. Deleted files are skipped because
 * they cannot be formatted. For renames/copies the NEW path is returned.
 */
export function parseNonStagedPorcelainZ(output: string): string[] {
    const entries = output.split('\0').filter(e => e.length > 0);
    const files: string[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.length < 4) {
            continue;
        }

        const status = entry.slice(0, 2);
        const filePath = entry.slice(3);
        const isRenameOrCopy = status[0] === 'R' || status[0] === 'C';

        if (isRenameOrCopy) {
            i++;
        }

        if (status === '??') {
            files.push(filePath);
            continue;
        }

        const worktreeStatus = status[1];

        if (worktreeStatus === 'D' || worktreeStatus === ' ') {
            continue;
        }

        files.push(filePath);
    }

    return files;
}
