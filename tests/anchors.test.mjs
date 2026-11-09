import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownExport, matchesOriginPattern, normalizePageUrl, originPattern, parseTags } from '../src/shared/anchors.ts';
import { parseBackup } from '../src/shared/storage.ts';

 test('normalizePageUrl removes fragments but preserves query strings', () => {
  assert.equal(normalizePageUrl('https://example.com/read?mode=full#section-3'), 'https://example.com/read?mode=full');
});

test('originPattern only permits HTTP and HTTPS origins', () => {
  assert.equal(originPattern('https://docs.example.com/a/b'), 'https://docs.example.com/*');
  assert.equal(originPattern('http://localhost:5173/test'), 'http://localhost/*');
  assert.equal(originPattern('file:///tmp/a.txt'), null);
  assert.equal(originPattern('chrome://extensions'), null);
  assert.equal(matchesOriginPattern('http://localhost/*', 'http://localhost:5173/page'), true);
  assert.equal(matchesOriginPattern('https://example.com/*', 'https://example.com.evil.test/page'), false);
  assert.equal(matchesOriginPattern('https://example.com/*', 'http://example.com/page'), false);
});

test('parseTags trims, de-duplicates, strips hashes, and caps tag count', () => {
  assert.deepEqual(parseTags(' Design, #research, design, , ideas '), ['design', 'research', 'ideas']);
});

test('markdownExport includes note, quote, tags, and original source', () => {
  const markdown = markdownExport([{
    id: '1', url: 'https://example.com/post#part', pageTitle: 'Example Article', quote: 'A useful passage',
    anchor: { version: 1, exact: 'A useful passage', prefix: '', suffix: '' }, note: 'Remember this',
    tags: ['research'], collection: 'Reading', color: 'amber', pinned: false, archived: false,
    createdAt: 1, updatedAt: 1
  }]);
  assert.match(markdown, /^# DogEar export/);
  assert.match(markdown, /## Reading/);
  assert.match(markdown, /A useful passage/);
  assert.match(markdown, /Remember this/);
  assert.match(markdown, /https:\/\/example.com\/post/);
});


test('parseBackup accepts a supported DogEar backup and normalizes entries', () => {
  const result = parseBackup({
    application: 'dogear', formatVersion: 1, exportedAt: '2026-11-09T00:00:00.000Z',
    annotations: [{ id: 'a1', url: 'https://example.com/post#quote', quote: 'A thought', note: 'Keep it', createdAt: 1 }]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://example.com/post');
  assert.equal(result[0].color, 'amber');
  assert.deepEqual(result[0].tags, []);
});

test('parseBackup accepts backup files exported by the previous product name', () => {
  const result = parseBackup({
    application: 'margin', formatVersion: 1, exportedAt: '2026-11-09T00:00:00.000Z',
    annotations: [{ id: 'old-export', url: 'https://example.com/article', quote: 'Saved quote', note: 'Old note', createdAt: 1 }]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'old-export');
});

test('parseBackup rejects malformed backups without partial import', () => {
  assert.throws(() => parseBackup({ application: 'other', formatVersion: 1, annotations: [] }));
  assert.throws(() => parseBackup({ application: 'dogear', formatVersion: 1, annotations: [{ note: 'missing identity' }] }));
});


test('parseBackup normalizes imported tags and trims collection metadata', () => {
  const result = parseBackup({
    application: 'dogear', formatVersion: 1, exportedAt: '2026-11-09T00:00:00.000Z',
    annotations: [{
      id: 'tags-1', url: 'https://example.com', quote: '', note: 'Thought',
      tags: [' Design ', '#research', 'design', 42], collection: '  Reading  ', createdAt: 1
    }]
  });
  assert.deepEqual(result[0].tags, ['design', 'research']);
  assert.equal(result[0].collection, 'Reading');
});

test('parseBackup rejects non-web source URLs', () => {
  assert.throws(() => parseBackup({
    application: 'dogear', formatVersion: 1, exportedAt: '2026-11-09T00:00:00.000Z',
    annotations: [{ id: 'bad-url', url: 'javascript:alert(1)', note: 'Nope' }]
  }));
});
