import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExcluded, maskToRegExp, matchesMasks, parseMasks } from '../core/mask';

test('parseMasks splits on commas/semicolons and trims', () => {
    assert.deepEqual(parseMasks('*.ts, *.tsx ;*.js'), ['*.ts', '*.tsx', '*.js']);
    assert.deepEqual(parseMasks(''), []);
    assert.deepEqual(parseMasks('  '), []);
});

test('maskToRegExp: * stays inside a path segment, ** crosses segments', () => {
    assert.ok(maskToRegExp('*.ts').test('file.ts'));
    assert.ok(!maskToRegExp('*.ts').test('dir/file.ts'));
    assert.ok(maskToRegExp('**/*.ts').test('a/b/file.ts'));
    assert.ok(maskToRegExp('file?.ts').test('file1.ts'));
    assert.ok(!maskToRegExp('file?.ts').test('file12.ts'));
});

test('maskToRegExp escapes regex special characters', () => {
    assert.ok(maskToRegExp('a+b.ts').test('a+b.ts'));
    assert.ok(!maskToRegExp('a+b.ts').test('aab.ts'));
});

test('matchesMasks: basename for simple masks, full path when mask has /', () => {
    assert.ok(matchesMasks('src/deep/file.ts', ['*.ts']));
    assert.ok(matchesMasks('src/deep/file.tsx', ['*.ts', '*.tsx']));
    assert.ok(!matchesMasks('src/deep/file.css', ['*.ts', '*.tsx']));
    assert.ok(matchesMasks('src/deep/file.ts', ['src/**/*.ts']));
    assert.ok(!matchesMasks('lib/file.ts', ['src/**/*.ts']));
});

test('matchesMasks: empty mask list matches everything', () => {
    assert.ok(matchesMasks('anything.xyz', []));
});

test('matchesMasks is case-insensitive like WebStorm masks', () => {
    assert.ok(matchesMasks('File.TS', ['*.ts']));
});

test('isExcluded handles **/dir/** patterns at any depth including root', () => {
    const excludes = ['**/node_modules/**', '**/dist/**', '**/*.min.*'];
    assert.ok(isExcluded('node_modules/pkg/index.js', excludes));
    assert.ok(isExcluded('a/b/node_modules/pkg/index.js', excludes));
    assert.ok(isExcluded('dist/bundle.js', excludes));
    assert.ok(isExcluded('src/vendor.min.js', excludes));
    assert.ok(!isExcluded('src/index.ts', excludes));
    assert.ok(!isExcluded('src/distance/index.ts', excludes));
});
