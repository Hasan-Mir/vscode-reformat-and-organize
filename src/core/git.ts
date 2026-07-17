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
