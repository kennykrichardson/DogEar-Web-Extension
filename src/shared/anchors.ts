import type { Annotation, TextAnchor } from './types';

export function normalizePageUrl(value: string): string {
  try { const url = new URL(value); url.hash = ''; return url.toString(); }
  catch { return value; }
}

export function annotationsForUrl(items: Annotation[], url: string): Annotation[] {
  const target = normalizePageUrl(url);
  return items.filter((item) => normalizePageUrl(item.url) === target && item.anchor?.exact);
}

export function originPattern(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Chrome match patterns identify scheme + host; ports are not part of the pattern.
    return `${url.protocol}//${url.hostname}/*`;
  } catch { return null; }
}

export function matchesOriginPattern(pattern: string, value: string): boolean {
  try {
    const permissionUrl = new URL(pattern.replace(/\/\*$/, '/'));
    const targetUrl = new URL(value);
    return permissionUrl.protocol === targetUrl.protocol && permissionUrl.hostname === targetUrl.hostname;
  } catch { return false; }
}

export function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((tag) => tag.trim().replace(/^#/, '').toLowerCase().slice(0, 32)).filter(Boolean))].slice(0, 20);
}

export function markdownExport(items: Annotation[]): string {
  const groups = new Map<string, Annotation[]>();
  for (const item of items) {
    const key = item.collection || 'Unsorted';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const sections = [...groups.entries()].map(([collection, entries]) => {
    const notes = entries.map((item) => [
      `### ${item.pageTitle || (() => { try { return new URL(item.url).hostname; } catch { return item.url; } })()}`,
      item.quote ? `> ${item.quote.replace(/\n/g, '\n> ')}` : '',
      item.note,
      item.tags.length ? `Tags: ${item.tags.map((tag) => `#${tag}`).join(' ')}` : '',
      `[Open source](${item.url})`,
      `_${new Date(item.createdAt).toLocaleString()}_`
    ].filter(Boolean).join('\n\n'));
    return `## ${collection}\n\n${notes.join('\n\n---\n\n')}`;
  });
  return `# DogEar export\n\nExported ${new Date().toLocaleString()}\n\n${sections.join('\n\n')}`;
}

export function isTextAnchor(value: unknown): value is TextAnchor {
  return Boolean(value && typeof value === 'object' && 'exact' in value && typeof (value as TextAnchor).exact === 'string');
}
