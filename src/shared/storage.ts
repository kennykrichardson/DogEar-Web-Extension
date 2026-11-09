import type { Annotation, BackupFile, DogEarSettings } from './types.ts';
import { DEFAULT_SETTINGS } from './types.ts';
import { parseTags } from './anchors.ts';

const ANNOTATIONS_KEY = 'dogear:annotations:v1';
const SETTINGS_KEY = 'dogear:settings:v1';
const PENDING_KEY = 'dogear:pending-selection:v1';

// Keep these legacy keys only for one-way migration from the previous DogEar-renamed release.
const LEGACY_ANNOTATION_KEYS = ['margin:annotations:v1', 'margin:annotations'] as const;
const LEGACY_SETTINGS_KEY = 'margin:settings:v1';
const LEGACY_PENDING_KEY = 'margin:pending-selection:v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value.trim();
  }
}

function cleanAnnotation(value: unknown): Annotation | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const url = typeof value.url === 'string' ? value.url : '';
  const note = typeof value.note === 'string' ? value.note : '';
  if (!id || !url) return null;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return null;
  } catch { return null; }
  const allowedColors = ['amber', 'blue', 'mint', 'rose', 'violet'] as const;
  const color = allowedColors.includes(value.color as typeof allowedColors[number])
    ? value.color as Annotation['color'] : 'amber';
  const anchorValue = isRecord(value.anchor) ? value.anchor : null;
  const anchor = anchorValue && typeof anchorValue.exact === 'string' ? {
    version: 1 as const,
    exact: anchorValue.exact,
    prefix: typeof anchorValue.prefix === 'string' ? anchorValue.prefix : '',
    suffix: typeof anchorValue.suffix === 'string' ? anchorValue.suffix : '',
    ...(typeof anchorValue.position === 'number' ? { position: anchorValue.position } : {})
  } : undefined;
  return {
    id, url: normalizeUrl(url),
    pageTitle: typeof value.pageTitle === 'string' ? value.pageTitle : '',
    quote: typeof value.quote === 'string' ? value.quote : anchor?.exact ?? '',
    ...(anchor ? { anchor } : {}),
    note,
    tags: Array.isArray(value.tags) ? parseTags(value.tags.filter((tag): tag is string => typeof tag === 'string').join(',')) : [],
    collection: typeof value.collection === 'string' ? value.collection.trim().slice(0, 60) : '',
    color,
    pinned: value.pinned === true,
    archived: value.archived === true,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now()
  };
}

let mutationQueue: Promise<void> = Promise.resolve();
function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  // The in-module queue protects callers in one extension page. Web Locks also
  // coordinates popup/workspace/background contexts that share this extension origin.
  const run = () => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('dogear:annotations:write', () => operation());
    }
    return operation();
  };
  const result = mutationQueue.then(run, run);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function normalizeAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) return [];
  const entries: unknown[] = value as unknown[];
  return entries
    .map((entry: unknown) => cleanAnnotation(entry))
    .filter((item: Annotation | null): item is Annotation => item !== null)
    .sort((a: Annotation, b: Annotation) => b.updatedAt - a.updatedAt);
}

function upgradeLegacyStarterEntry(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  const quote = typeof entry.quote === 'string' ? entry.quote : '';
  return {
    ...entry,
    anchor: quote ? {
      version: 1,
      exact: quote,
      prefix: typeof entry.prefix === 'string' ? entry.prefix : '',
      suffix: typeof entry.suffix === 'string' ? entry.suffix : ''
    } : undefined,
    tags: [], collection: '', color: 'amber', pinned: false, archived: false,
    updatedAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now()
  };
}

export async function getAnnotations(): Promise<Annotation[]> {
  const keys = [ANNOTATIONS_KEY, ...LEGACY_ANNOTATION_KEYS];
  const result = await chrome.storage.local.get(keys);
  const current = result[ANNOTATIONS_KEY];

  if (Array.isArray(current)) {
    // A current DogEar store is authoritative. Remove any stale predecessor keys.
    await chrome.storage.local.remove([...LEGACY_ANNOTATION_KEYS]);
    return normalizeAnnotations(current);
  }

  const legacyKey = LEGACY_ANNOTATION_KEYS.find((key) => Array.isArray(result[key]));
  if (!legacyKey) return [];

  const legacyEntries = result[legacyKey] as unknown[];
  const migrationInput = legacyKey === 'margin:annotations'
    ? legacyEntries.map((entry: unknown) => upgradeLegacyStarterEntry(entry))
    : legacyEntries;
  const migrated = normalizeAnnotations(migrationInput);

  // Write the new namespace before removing the old one, so an interrupted
  // migration can safely retry without losing the original data.
  await chrome.storage.local.set({ [ANNOTATIONS_KEY]: migrated });
  await chrome.storage.local.remove([...LEGACY_ANNOTATION_KEYS]);
  return migrated;
}

export async function saveAnnotation(annotation: Annotation): Promise<void> {
  return serializeMutation(async () => {
    const current = await getAnnotations();
    const next = [annotation, ...current.filter((item) => item.id !== annotation.id)];
    await chrome.storage.local.set({ [ANNOTATIONS_KEY]: next });
  });
}

export async function updateAnnotation(id: string, changes: Partial<Annotation>): Promise<void> {
  return serializeMutation(async () => {
    const current = await getAnnotations();
    const next = current.map((item) => item.id === id
      ? { ...item, ...changes, id, updatedAt: Date.now() }
      : item);
    await chrome.storage.local.set({ [ANNOTATIONS_KEY]: next });
  });
}

export async function deleteAnnotation(id: string): Promise<Annotation | null> {
  return serializeMutation(async () => {
    const current = await getAnnotations();
    const removed = current.find((item) => item.id === id) ?? null;
    await chrome.storage.local.set({ [ANNOTATIONS_KEY]: current.filter((item) => item.id !== id) });
    return removed;
  });
}

export async function replaceAnnotations(annotations: Annotation[]): Promise<void> {
  return serializeMutation(async () => {
    const normalized = annotations.map(cleanAnnotation).filter((item): item is Annotation => item !== null);
    await chrome.storage.local.set({ [ANNOTATIONS_KEY]: normalized });
  });
}

function normalizeSettings(value: unknown): DogEarSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;
  return {
    theme: value.theme === 'dark' || value.theme === 'system' ? value.theme : 'light',
    defaultColor: ['amber', 'blue', 'mint', 'rose', 'violet'].includes(String(value.defaultColor))
      ? value.defaultColor as DogEarSettings['defaultColor'] : 'amber',
    enabledOrigins: Array.isArray(value.enabledOrigins)
      ? (value.enabledOrigins as unknown[]).filter((origin: unknown): origin is string => typeof origin === 'string') : [],
    showPageHighlights: value.showPageHighlights !== false
  };
}

export async function getSettings(): Promise<DogEarSettings> {
  const result = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  if (isRecord(result[SETTINGS_KEY])) {
    await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
    return normalizeSettings(result[SETTINGS_KEY]);
  }
  if (isRecord(result[LEGACY_SETTINGS_KEY])) {
    const migrated = normalizeSettings(result[LEGACY_SETTINGS_KEY]);
    await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
    await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
    return migrated;
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: DogEarSettings): Promise<void> {
  const write = () => chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    await navigator.locks.request('dogear:settings:write', write);
  } else {
    await write();
  }
}

export async function getPendingSelection<T>(): Promise<T | null> {
  const result = await chrome.storage.local.get([PENDING_KEY, LEGACY_PENDING_KEY]);
  const current = result[PENDING_KEY];
  if (current && isRecord(current)) {
    await chrome.storage.local.remove(LEGACY_PENDING_KEY);
    return current as T;
  }
  const legacy = result[LEGACY_PENDING_KEY];
  if (legacy && isRecord(legacy)) {
    await chrome.storage.local.set({ [PENDING_KEY]: legacy });
    await chrome.storage.local.remove(LEGACY_PENDING_KEY);
    return legacy as T;
  }
  return null;
}

export async function setPendingSelection(value: unknown): Promise<void> {
  await chrome.storage.local.set({ [PENDING_KEY]: value });
}

export async function clearPendingSelection(): Promise<void> {
  await chrome.storage.local.remove(PENDING_KEY);
}

export async function createBackup(): Promise<BackupFile> {
  return {
    application: 'dogear',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    annotations: await getAnnotations()
  };
}

export function parseBackup(value: unknown): Annotation[] {
  if (!isRecord(value) || (value.application !== 'dogear' && value.application !== 'margin') || value.formatVersion !== 1 || !Array.isArray(value.annotations)) {
    throw new Error('This file is not a supported DogEar backup.');
  }
  const entries = value.annotations as unknown[];
  const annotations = entries.map((entry: unknown) => cleanAnnotation(entry)).filter((item: Annotation | null): item is Annotation => item !== null);
  if (annotations.length !== entries.length) {
    throw new Error('The backup contains invalid entries. No data was imported.');
  }
  const unique = new Map(annotations.map((item) => [item.id, item]));
  return [...unique.values()];
}
