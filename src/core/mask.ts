/**
 * WebStorm-style file mask handling (pure functions — unit tested).
 *
 * A mask string looks like: "*.ts, *.tsx" (masks may also contain `/` and `**`).
 */

/** Split a comma/semicolon separated mask string into individual masks. */
export function parseMasks(input: string): string[] {
    return input
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

/**
 * Convert one mask into a RegExp.
 * `*` matches within a path segment, `?` matches one character, `**` matches
 * across segments.
 */
export function maskToRegExp(mask: string): RegExp {
    let re = '';
    for (let i = 0; i < mask.length; i++) {
        const ch = mask[i];
        if (ch === '*') {
            if (mask[i + 1] === '*') {
                re += '.*';
                i++;
            } else {
                re += '[^/]*';
            }
        } else if (ch === '?') {
            re += '[^/]';
        } else if ('\\.[]{}()+-^$|'.includes(ch)) {
            re += '\\' + ch;
        } else {
            re += ch;
        }
    }
    return new RegExp(`^${re}$`, 'i');
}

/**
 * Does `relPath` (workspace-relative, `/`-separated) match at least one mask?
 * Masks without a `/` are matched against the basename, masks with a `/`
 * against the whole relative path. An empty mask list matches everything.
 */
export function matchesMasks(relPath: string, masks: string[]): boolean {
    if (masks.length === 0) return true;
    const base = relPath.split('/').pop() ?? relPath;
    return masks.some(m => maskToRegExp(m).test(m.includes('/') ? relPath : base));
}

/** Is `relPath` excluded by one of the exclude glob patterns? */
export function isExcluded(relPath: string, patterns: string[]): boolean {
    return patterns.some(p => {
        const re = maskToRegExp(p);
        // Test both with and without a leading slash so "**" + "/dir/" + "**"
        // patterns also match paths starting with "dir/" at the repo root.
        return re.test(relPath) || re.test('/' + relPath);
    });
}
