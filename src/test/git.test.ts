import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePorcelainZ } from '../core/git';

const NUL = '\0';

test('parsePorcelainZ: modified, added, untracked', () => {
    const out = [' M src/a.ts', 'A  src/b.ts', '?? src/new.ts'].join(NUL) + NUL;
    assert.deepEqual(parsePorcelainZ(out), ['src/a.ts', 'src/b.ts', 'src/new.ts']);
});

test('parsePorcelainZ: skips deleted files', () => {
    const out = [' D gone.ts', 'D  staged-gone.ts', ' M kept.ts'].join(NUL) + NUL;
    assert.deepEqual(parsePorcelainZ(out), ['kept.ts']);
});

test('parsePorcelainZ: rename keeps the new path and skips the original record', () => {
    const out = ['R  new-name.ts', 'old-name.ts', ' M other.ts'].join(NUL) + NUL;
    assert.deepEqual(parsePorcelainZ(out), ['new-name.ts', 'other.ts']);
});

test('parsePorcelainZ: paths with spaces survive -z parsing', () => {
    const out = [' M src/my file.ts'].join(NUL) + NUL;
    assert.deepEqual(parsePorcelainZ(out), ['src/my file.ts']);
});

test('parsePorcelainZ: empty output means no changed files', () => {
    assert.deepEqual(parsePorcelainZ(''), []);
});
