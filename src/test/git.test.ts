import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNonStagedPorcelainZ, parsePorcelainZ, parseStagedPorcelainZ } from '../core/git';

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

test('parseStagedPorcelainZ: only includes files staged in the index', () => {
    const out =
        [
            ' M unstaged.ts',
            'M  staged-mod.ts',
            'MM staged-both.ts',
            'A  staged-add.ts',
            'AM staged-add-mod.ts',
            '?? untracked.ts',
        ].join(NUL) + NUL;
    assert.deepEqual(parseStagedPorcelainZ(out), [
        'staged-mod.ts',
        'staged-both.ts',
        'staged-add.ts',
        'staged-add-mod.ts',
    ]);
});

test('parseStagedPorcelainZ: skips deleted files even if staged', () => {
    const out = ['D  staged-del.ts', 'MD staged-mod-del.ts', 'M  kept.ts'].join(NUL) + NUL;
    assert.deepEqual(parseStagedPorcelainZ(out), ['kept.ts']);
});

test('parseStagedPorcelainZ: rename keeps the new path and skips the original record', () => {
    const out = ['R  new-name.ts', 'old-name.ts', ' M unstaged.ts'].join(NUL) + NUL;
    assert.deepEqual(parseStagedPorcelainZ(out), ['new-name.ts']);
});

test('parseStagedPorcelainZ: copy keeps the new path and skips the original record', () => {
    const out = ['C  copy-dest.ts', 'copy-src.ts', ' M unstaged.ts'].join(NUL) + NUL;
    assert.deepEqual(parseStagedPorcelainZ(out), ['copy-dest.ts']);
});

test('parseNonStagedPorcelainZ: includes unstaged and untracked files', () => {
    const out =
        [' M unstaged.ts', '?? untracked.ts', 'M  staged-only.ts', 'A  staged-add.ts'].join(NUL) +
        NUL;

    assert.deepEqual(parseNonStagedPorcelainZ(out), ['unstaged.ts', 'untracked.ts']);
});

test('parseNonStagedPorcelainZ: includes files with both staged and unstaged changes', () => {
    const out =
        [
            'MM staged-and-unstaged.ts',
            'AM added-and-modified.ts',
            'RM renamed-and-modified.ts',
            'M  staged-only.ts',
            'A  staged-add.ts',
        ].join(NUL) + NUL;

    assert.deepEqual(parseNonStagedPorcelainZ(out), [
        'staged-and-unstaged.ts',
        'added-and-modified.ts',
        'renamed-and-modified.ts',
    ]);
});

test('parseNonStagedPorcelainZ: skips deleted files', () => {
    const out =
        [
            ' D unstaged-deleted.ts',
            'MD staged-mod-del.ts',
            'RD renamed-but-deleted.ts',
            'old-deleted.ts',
            ' M kept.ts',
        ].join(NUL) + NUL;

    assert.deepEqual(parseNonStagedPorcelainZ(out), ['kept.ts']);
});

test('parseNonStagedPorcelainZ: skips staged-only rename and copy', () => {
    const out =
        ['R  new-name.ts', 'old-name.ts', 'C  copy-dest.ts', 'copy-src.ts', ' M kept.ts'].join(
            NUL
        ) + NUL;

    assert.deepEqual(parseNonStagedPorcelainZ(out), ['kept.ts']);
});

test('parseNonStagedPorcelainZ: keeps the new path for a rename with unstaged changes', () => {
    const out = ['RM new-name.ts', 'old-name.ts', ' M other.ts'].join(NUL) + NUL;

    assert.deepEqual(parseNonStagedPorcelainZ(out), ['new-name.ts', 'other.ts']);
});

test('parseNonStagedPorcelainZ: empty output means no non-staged files', () => {
    assert.deepEqual(parseNonStagedPorcelainZ(''), []);
});

test('parseNonStagedPorcelainZ: paths with spaces survive -z parsing', () => {
    const out = [' M src/my file.ts'].join(NUL) + NUL;
    assert.deepEqual(parseNonStagedPorcelainZ(out), ['src/my file.ts']);
});
