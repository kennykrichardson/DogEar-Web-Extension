import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(projectRoot, 'dist');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = async (path) => access(path).then(() => true, () => false);
const requireFile = async (relativePath) => {
  const path = resolve(dist, relativePath);
  if (!(await exists(path))) throw new Error(`Build is missing required file: ${relativePath}`);
  return path;
};

const manifest = await readJson(resolve(dist, 'manifest.json'));
if (manifest.manifest_version !== 3) throw new Error('DogEar must ship as a Manifest V3 extension.');
await requireFile(manifest.action?.default_popup);
await requireFile('workspace.html');
await requireFile(manifest.background?.service_worker);
for (const icon of Object.values(manifest.icons ?? {})) await requireFile(icon);
for (const icon of Object.values(manifest.action?.default_icon ?? {})) await requireFile(icon);

// The content helper is injected as a classic script through chrome.scripting.executeScript.
// It must remain self-contained and cannot depend on module imports or sibling chunks.
const contentPath = await requireFile('content.js');
const content = await readFile(contentPath, 'utf8');
if (/^\s*import\s/m.test(content) || /\bimport\s*\(/.test(content) || /^\s*export\s/m.test(content)) {
  throw new Error('content.js is not self-contained. The injected helper must not contain module imports or exports.');
}

// Verify that the generated HTML documents and their referenced local JS/CSS bundles exist.
for (const htmlName of ['index.html', 'workspace.html']) {
  const htmlPath = await requireFile(htmlName);
  const html = await readFile(htmlPath, 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    if (/^(?:https?:|data:|#)/i.test(reference)) continue;
    const assetPath = resolve(dirname(htmlPath), reference.replace(/^\.\//, ''));
    if (!(await exists(assetPath))) throw new Error(`${htmlName} references a missing build asset: ${reference}`);
  }
}

console.log('DogEar production package verification passed.');
