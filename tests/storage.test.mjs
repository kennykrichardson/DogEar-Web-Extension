import test from 'node:test';
import assert from 'node:assert/strict';

const state = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(requested.filter((key) => state.has(key)).map((key) => [key, state.get(key)]));
      },
      async set(values) { for (const [key, value] of Object.entries(values)) state.set(key, value); },
      async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) state.delete(key); }
    }
  }
};

const storage = await import('../src/shared/storage.ts');

function annotation(id, createdAt = Date.now()) {
  return {
    id, url: `https://${id}.example/article`, pageTitle: `${id} article`, quote: 'A saved passage',
    anchor: { version: 1, exact: 'A saved passage', prefix: '', suffix: '' }, note: `Thought ${id}`,
    tags: ['test'], collection: 'Testing', color: 'amber', pinned: false, archived: false,
    createdAt, updatedAt: createdAt
  };
}

test('migrates the original 0.x starter annotations into the DogEar namespace', async () => {
  state.clear();
  state.set('margin:annotations', [{
    id: 'legacy-1', url: 'https://example.com/post', pageTitle: 'Old note', quote: 'A passage',
    prefix: 'Before ', suffix: ' after', note: 'Legacy thought', createdAt: 123
  }]);

  const items = await storage.getAnnotations();
  assert.equal(items.length, 1);
  assert.equal(items[0].anchor.exact, 'A passage');
  assert.equal(items[0].anchor.prefix, 'Before ');
  assert.equal(items[0].note, 'Legacy thought');
  assert.equal(state.has('margin:annotations'), false);
  assert.equal(state.has('margin:annotations:v1'), false);
  assert.equal(state.get('dogear:annotations:v1').length, 1);
});

test('migrates existing 1.0 annotations, settings, and a pending selection', async () => {
  state.clear();
  state.set('margin:annotations:v1', [annotation('prior-release', 500)]);
  state.set('margin:settings:v1', {
    theme: 'dark', defaultColor: 'violet', enabledOrigins: ['https://example.com/*'], showPageHighlights: false
  });
  state.set('margin:pending-selection:v1', {
    quote: 'A pending passage', url: 'https://example.com/page', pageTitle: 'Pending'
  });

  const annotations = await storage.getAnnotations();
  const settings = await storage.getSettings();
  const pending = await storage.getPendingSelection();

  assert.equal(annotations[0].id, 'prior-release');
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.defaultColor, 'violet');
  assert.equal(settings.showPageHighlights, false);
  assert.equal(pending.quote, 'A pending passage');
  assert.ok(state.has('dogear:annotations:v1'));
  assert.ok(state.has('dogear:settings:v1'));
  assert.ok(state.has('dogear:pending-selection:v1'));
  assert.equal(state.has('margin:annotations:v1'), false);
  assert.equal(state.has('margin:settings:v1'), false);
  assert.equal(state.has('margin:pending-selection:v1'), false);
});

test('a malformed current value does not crash migration or mask valid legacy data', async () => {
  state.clear();
  state.set('dogear:annotations:v1', { unexpected: true });
  state.set('margin:annotations:v1', [annotation('recoverable', 250)]);

  const items = await storage.getAnnotations();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'recoverable');
  assert.deepEqual(state.get('dogear:annotations:v1').map((item) => item.id), ['recoverable']);
});

test('malformed storage with no recoverable legacy value safely returns an empty library', async () => {
  state.clear();
  state.set('dogear:annotations:v1', { unexpected: true });
  assert.deepEqual(await storage.getAnnotations(), []);
});

test('serializes parallel saves without dropping either annotation', async () => {
  state.clear();
  await Promise.all([storage.saveAnnotation(annotation('first', 100)), storage.saveAnnotation(annotation('second', 200))]);
  const items = await storage.getAnnotations();
  assert.deepEqual(new Set(items.map((item) => item.id)), new Set(['first', 'second']));
  assert.equal(items[0].id, 'second');
});

test('updates and deletes annotations while preserving identity', async () => {
  state.clear();
  await storage.saveAnnotation(annotation('edit-me', 100));
  await storage.updateAnnotation('edit-me', { note: 'Edited thought', pinned: true });
  const updated = (await storage.getAnnotations())[0];
  assert.equal(updated.id, 'edit-me');
  assert.equal(updated.note, 'Edited thought');
  assert.equal(updated.pinned, true);
  assert.ok(updated.updatedAt >= 100);

  const deleted = await storage.deleteAnnotation('edit-me');
  assert.equal(deleted.id, 'edit-me');
  assert.deepEqual(await storage.getAnnotations(), []);
});

test('new exports use DogEar identity and the current storage namespace', async () => {
  state.clear();
  await storage.saveAnnotation(annotation('exported', 700));
  const backup = await storage.createBackup();
  assert.equal(backup.application, 'dogear');
  assert.equal(backup.annotations[0].id, 'exported');
});
