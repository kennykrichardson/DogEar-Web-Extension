import type { Annotation, TextAnchor } from '../shared/types';
import { findBestAnchorPosition, normalizeAnchorText } from '../shared/text-anchor';

(() => {
const contentScope = globalThis as typeof globalThis & { __DOGEAR_CONTENT_INITIALIZED__?: boolean };
if (!contentScope.__DOGEAR_CONTENT_INITIALIZED__) {
contentScope.__DOGEAR_CONTENT_INITIALIZED__ = true;
// Remove stale page decorations if this document was open during the product rename.
document.getElementById('margin-highlight-styles')?.remove();
const pageHighlights = (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights;
if (pageHighlights) {
  for (const oldName of ['margin-amber', 'margin-blue', 'margin-mint', 'margin-rose', 'margin-violet', 'margin-focus']) {
    pageHighlights.delete(oldName);
  }
}

interface IndexedText {
  normalized: string;
  nodes: Text[];
  nodeIndices: Uint32Array;
  offsets: Uint32Array;
}

const BLOCK_SELECTOR = 'address,article,aside,blockquote,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,li,main,nav,ol,p,pre,section,table,tbody,td,th,tr,ul';

const STYLE_ID = 'dogear-highlight-styles';
const HIGHLIGHT_PREFIX = 'dogear-';
let lastRenderedIds: string[] = [];
let focusTimeout: number | undefined;

function isExcluded(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest('script,style,noscript,svg,canvas,textarea,input,select,option,[contenteditable],[aria-hidden="true"],[hidden]'));
}

function buildTextIndex(): IndexedText {
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ALL);
  const nodes: Text[] = [];
  const nodeIds = new Map<Text, number>();
  const rawParts: string[] = [];
  const rawNodeIndices: number[] = [];
  const rawOffsets: number[] = [];
  let previousNode: Text | null = null;
  let previousBlock: Element | null = null;
  let previousNodeId = -1;
  let lineBreakPending = false;

  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current.nodeType === Node.ELEMENT_NODE && (current as Element).tagName === 'BR') {
      lineBreakPending = true;
      continue;
    }
    if (current.nodeType !== Node.TEXT_NODE) continue;
    const node = current as Text;
    if (isExcluded(node) || !node.data) continue;
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? document.body;
    let nodeId = nodeIds.get(node);
    if (nodeId === undefined) {
      nodeId = nodes.length;
      nodeIds.set(node, nodeId);
      nodes.push(node);
    }

    // Text nodes in separate block elements are visually separated even when the DOM
    // contains no literal whitespace (for example, adjacent paragraphs or list items).
    if (previousNode && (lineBreakPending || previousBlock !== block) && !/\s$/.test(previousNode.data) && !/^\s/.test(node.data)) {
      rawParts.push(' ');
      rawNodeIndices.push(previousNodeId);
      rawOffsets.push(previousNode.data.length);
    }

    rawParts.push(node.data);
    for (let offset = 0; offset < node.data.length; offset += 1) {
      rawNodeIndices.push(nodeId);
      rawOffsets.push(offset);
    }
    previousNode = node;
    previousBlock = block;
    lineBreakPending = false;
    previousNodeId = nodeId;
  }

  const raw = rawParts.join('');
  let normalized = '';
  const normalizedNodeIndices: number[] = [];
  const normalizedOffsets: number[] = [];
  let whitespacePending = false;
  let whitespaceNodeIndex = 0;
  let whitespaceOffset = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (/\s/.test(character)) {
      if (!whitespacePending) {
        whitespaceNodeIndex = rawNodeIndices[index];
        whitespaceOffset = rawOffsets[index];
      }
      whitespacePending = true;
      continue;
    }
    if (whitespacePending && normalized.length) {
      normalized += ' ';
      normalizedNodeIndices.push(whitespaceNodeIndex);
      normalizedOffsets.push(whitespaceOffset);
    }
    whitespacePending = false;
    normalized += character;
    normalizedNodeIndices.push(rawNodeIndices[index]);
    normalizedOffsets.push(rawOffsets[index]);
  }

  return {
    normalized,
    nodes,
    nodeIndices: Uint32Array.from(normalizedNodeIndices),
    offsets: Uint32Array.from(normalizedOffsets)
  };
}

function mappedPoint(index: IndexedText, position: number): { node: Text; offset: number } | null {
  const nodeId = index.nodeIndices[position];
  const node = index.nodes[nodeId];
  if (!node) return null;
  return { node, offset: index.offsets[position] };
}

function findRange(anchor: TextAnchor, index: IndexedText): Range | null {
  const position = findBestAnchorPosition(index.normalized, anchor);
  if (position === null) return null;
  const exact = normalizeAnchorText(anchor.exact);
  const first = mappedPoint(index, position);
  const last = mappedPoint(index, position + exact.length - 1);
  if (!first || !last) return null;
  const range = document.createRange();
  try {
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
    return range;
  } catch { return null; }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(dogear-amber){background:rgba(238,184,82,.38);color:inherit}
    ::highlight(dogear-blue){background:rgba(106,164,221,.32);color:inherit}
    ::highlight(dogear-mint){background:rgba(104,184,153,.32);color:inherit}
    ::highlight(dogear-rose){background:rgba(219,137,146,.30);color:inherit}
    ::highlight(dogear-violet){background:rgba(159,139,215,.30);color:inherit}
    ::highlight(dogear-focus){background:rgba(191,132,82,.52);color:inherit;text-decoration:underline;text-decoration-color:rgba(139,91,54,.8);text-decoration-thickness:2px}
  `;
  (document.head ?? document.documentElement).append(style);
}

function clearHighlights(): void {
  if (focusTimeout !== undefined) {
    window.clearTimeout(focusTimeout);
    focusTimeout = undefined;
  }
  const registry = (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights;
  if (registry) {
    for (const id of lastRenderedIds) registry.delete(`${HIGHLIGHT_PREFIX}${id}`);
    registry.delete('dogear-focus');
  }
  lastRenderedIds = [];
}

function renderHighlights(annotations: Annotation[]): { rendered: number; missed: number; unsupported: boolean } {
  const anchored = annotations.filter((annotation) => Boolean(annotation.anchor?.exact));
  const registry = (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights;
  const HighlightConstructor = (window as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  clearHighlights();
  if (!registry || !HighlightConstructor) return { rendered: 0, missed: anchored.length, unsupported: true };
  ensureStyles();
  const index = buildTextIndex();
  const grouped = new Map<string, Range[]>();
  let missed = 0;
  for (const annotation of annotations) {
    if (!annotation.anchor?.exact) continue;
    const range = findRange(annotation.anchor, index);
    if (!range) { missed += 1; continue; }
    const color = annotation.color ?? 'amber';
    grouped.set(color, [...(grouped.get(color) ?? []), range]);
  }
  for (const [color, ranges] of grouped) {
    const key = `${HIGHLIGHT_PREFIX}${color}`;
    registry.set(key, new HighlightConstructor(...ranges));
    lastRenderedIds.push(color);
  }
  return { rendered: anchored.length - missed, missed, unsupported: false };
}

function getSelectionPayload(): { ok: boolean; selection?: { quote: string; anchor: TextAnchor; url: string; pageTitle: string }; error?: string } {
  const selection = window.getSelection();
  const quote = selection?.toString().trim() ?? '';
  if (!selection || !quote || selection.rangeCount === 0) return { ok: false, error: 'Select a passage on the page first.' };
  const index = buildTextIndex();
  const normalizedQuote = normalizeAnchorText(quote);
  const selectedRange = selection.getRangeAt(0);
  let position = -1;
  for (let candidate = 0; candidate < index.nodeIndices.length; candidate += 1) {
    const point = mappedPoint(index, candidate);
    if (!point) continue;
    try {
      if (selectedRange.comparePoint(point.node, point.offset) === 0) { position = candidate; break; }
    } catch { /* A later fallback handles unusual DOM ranges. */ }
  }
  if (position < 0) position = index.normalized.indexOf(normalizedQuote);
  const prefix = position >= 0 ? index.normalized.slice(Math.max(0, position - 100), position) : '';
  const suffix = position >= 0 ? index.normalized.slice(position + normalizedQuote.length, position + normalizedQuote.length + 100) : '';
  return {
    ok: true,
    selection: {
      quote,
      anchor: { version: 1, exact: quote, prefix, suffix, ...(position >= 0 ? { position } : {}) },
      url: location.href.split('#')[0],
      pageTitle: document.title
    }
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'DOGEAR_GET_SELECTION') {
    sendResponse(getSelectionPayload());
    return false;
  }
  if (message?.type === 'DOGEAR_RENDER_HIGHLIGHTS') {
    const annotations = Array.isArray(message.annotations) ? message.annotations as Annotation[] : [];
    sendResponse({ ok: true, ...renderHighlights(annotations) });
    return false;
  }
  if (message?.type === 'DOGEAR_CLEAR_HIGHLIGHTS') {
    clearHighlights();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'DOGEAR_SCROLL_TO_ANNOTATION') {
    const annotation = message.annotation as Annotation | undefined;
    if (!annotation?.anchor) { sendResponse({ ok: false }); return false; }
    const range = findRange(annotation.anchor, buildTextIndex());
    if (!range) { sendResponse({ ok: false, error: 'Passage not found on this page.' }); return false; }
    const element = range.startContainer.parentElement;
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const registry = (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights;
    const HighlightConstructor = (window as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (registry && HighlightConstructor) {
      registry.set('dogear-focus', new HighlightConstructor(range));
      focusTimeout = window.setTimeout(() => { registry.delete('dogear-focus'); focusTimeout = undefined; }, 2200);
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// If this script was injected on a page for which the user granted persistent access,
// draw saved highlights immediately. It never reads or transmits page content elsewhere.
void chrome.storage.local.get([
  'dogear:annotations:v1', 'dogear:settings:v1',
  'margin:annotations:v1', 'margin:annotations', 'margin:settings:v1'
]).then((result) => {
  const items = Array.isArray(result['dogear:annotations:v1'])
    ? result['dogear:annotations:v1']
    : Array.isArray(result['margin:annotations:v1'])
      ? result['margin:annotations:v1']
      : result['margin:annotations'];
  const settings = (result['dogear:settings:v1'] ?? result['margin:settings:v1']) as { showPageHighlights?: boolean } | undefined;
  if (settings?.showPageHighlights === false || !Array.isArray(items)) return;
  const current = location.href.split('#')[0];
  const matching = (items as Annotation[]).map((item) => {
    if (item.anchor?.exact || !item.quote) return item;
    return { ...item, anchor: { version: 1 as const, exact: item.quote, prefix: '', suffix: '' } };
  }).filter((item) => item.url?.split('#')[0] === current && !item.archived && item.anchor?.exact);
  if (matching.length) renderHighlights(matching);
});

}

})();
