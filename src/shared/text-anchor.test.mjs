import test from 'node:test';
import assert from 'node:assert/strict';
import { findBestAnchorPosition, normalizeAnchorText } from './text-anchor.ts';

test('normalizes line breaks, tabs, and repeated whitespace', () => {
  assert.equal(normalizeAnchorText('  A useful\n\t passage  '), 'A useful passage');
});

test('finds a unique passage even when whitespace is normalized', () => {
  const page = 'An opening paragraph. A useful passage appears here. The end.';
  assert.equal(findBestAnchorPosition(page, { version: 1, exact: 'A useful\npassage', prefix: '', suffix: '' }), 22);
});

test('uses prefix and suffix context to choose among duplicate passages', () => {
  const page = 'The first chapter discusses the same idea. Later, the same idea is applied.';
  const position = findBestAnchorPosition(page, {
    version: 1, exact: 'the same idea', prefix: 'The first chapter discusses ', suffix: ' appears here', position: 0
  });
  assert.equal(position, page.indexOf('the same idea'));
});

test('uses the position hint when repeated quotes have no surrounding context', () => {
  const page = 'repeat once, then repeat again';
  const expected = page.lastIndexOf('repeat');
  assert.equal(findBestAnchorPosition(page, { version: 1, exact: 'repeat', prefix: '', suffix: '', position: expected }), expected);
});

test('returns null when the quote is absent or empty', () => {
  assert.equal(findBestAnchorPosition('Nothing to see', { version: 1, exact: 'missing', prefix: '', suffix: '' }), null);
  assert.equal(findBestAnchorPosition('Something', { version: 1, exact: '  ', prefix: '', suffix: '' }), null);
});


test('considers overlapping quote occurrences', () => {
  const page = 'aaaa';
  assert.equal(findBestAnchorPosition(page, { version: 1, exact: 'aaa', prefix: '', suffix: '', position: 1 }), 1);
});
