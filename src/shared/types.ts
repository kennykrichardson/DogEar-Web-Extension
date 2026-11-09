export type HighlightColor = 'amber' | 'blue' | 'mint' | 'rose' | 'violet';
export type LibraryView = 'all' | 'pinned' | 'archived';
export type SortOrder = 'newest' | 'oldest' | 'updated' | 'site';

export interface TextAnchor {
  version: 1;
  exact: string;
  prefix: string;
  suffix: string;
  /** Offset in a whitespace-normalized text representation of the page. */
  position?: number;
}

export interface Annotation {
  id: string;
  url: string;
  pageTitle: string;
  quote: string;
  anchor?: TextAnchor;
  note: string;
  tags: string[];
  collection: string;
  color: HighlightColor;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SelectionPayload {
  quote: string;
  anchor: TextAnchor;
  url: string;
  pageTitle: string;
}

export interface DogEarSettings {
  theme: 'light' | 'dark' | 'system';
  defaultColor: HighlightColor;
  enabledOrigins: string[];
  showPageHighlights: boolean;
}

export interface BackupFile {
  application: 'dogear';
  formatVersion: 1;
  exportedAt: string;
  annotations: Annotation[];
}

export const DEFAULT_SETTINGS: DogEarSettings = {
  theme: 'light',
  defaultColor: 'amber',
  enabledOrigins: [],
  showPageHighlights: true
};
