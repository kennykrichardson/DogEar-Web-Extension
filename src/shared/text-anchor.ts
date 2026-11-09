import type { TextAnchor } from './types.ts';

/** Collapse all whitespace in the same way the page index and saved quotes are compared. */
export function normalizeAnchorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function commonSuffixLength(left: string, right: string): number {
  let count = 0;
  while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1;
  return count;
}

function commonPrefixLength(left: string, right: string): number {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
  return count;
}

/**
 * Find the strongest occurrence of a saved quote in whitespace-normalized page text.
 * Prefix/suffix context disambiguates repeated quotes; the stored position is a fallback.
 */
export function findBestAnchorPosition(pageText: string, anchor: TextAnchor): number | null {
  const exact = normalizeAnchorText(anchor.exact);
  if (!exact || !pageText) return null;

  const prefix = normalizeAnchorText(anchor.prefix).slice(-100);
  const suffix = normalizeAnchorText(anchor.suffix).slice(0, 100);
  let bestPosition: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let cursor = 0;

  while ((cursor = pageText.indexOf(exact, cursor)) !== -1) {
    const position = cursor;
    const before = pageText.slice(Math.max(0, position - prefix.length), position);
    const after = pageText.slice(position + exact.length, position + exact.length + suffix.length);
    let score = 0;
    if (prefix) score += commonSuffixLength(before, prefix);
    if (suffix) score += commonPrefixLength(after, suffix);
    if (typeof anchor.position === 'number' && Number.isFinite(anchor.position) && anchor.position >= 0) {
      score -= Math.min(30, Math.abs(position - anchor.position) / 20);
    }
    if (bestPosition === null || score > bestScore) {
      bestScore = score;
      bestPosition = position;
    }
    // Advance one character so overlapping occurrences are considered too.
    cursor += 1;
  }
  return bestPosition;
}
