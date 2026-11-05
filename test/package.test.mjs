// The published tarball must contain the runtime files and nothing from the repo's
// dev-only tree (tests, samples, source, lint config).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('npm package contains runtime files and excludes dev files', () => {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
  const [pack] = JSON.parse(raw);
  const files = new Set(pack.files.map(file => file.path));

  for (const expected of [
    'dist/index.js',
    'config.schema.json',
    'homebridge-ui/public/index.html',
    'CHANGELOG.md',
    'README.md',
    'package.json',
  ]) {
    assert.ok(files.has(expected), `package includes ${expected}`);
  }

  for (const excluded of [
    'src/index.ts',
    'test/plugin.test.mjs',
    'sample/washer_dryer.json',
    'eslint.config.mjs',
    'nodemon.json',
    'tsconfig.json',
    'package-lock.json',
  ]) {
    assert.ok(!files.has(excluded), `package excludes ${excluded}`);
  }
});
