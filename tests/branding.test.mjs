import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('package and Manifest V3 metadata use the DogEar identity', async () => {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, 'public/manifest.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));

  assert.equal(manifest.name, 'DogEar • Notes on the web');
  assert.equal(manifest.short_name, 'DogEar');
  assert.equal(packageJson.name, 'dogear-browser-extension');
  assert.ok(manifest.commands['open-dogear']);
  assert.equal(manifest.commands['open-dogear'].suggested_key.default, 'Alt+Shift+Z');

  const iconPaths = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  for (const iconPath of new Set(iconPaths)) {
    await access(resolve(projectRoot, 'public', iconPath));
  }
});
