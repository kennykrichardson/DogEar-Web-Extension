import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowDownUp, ArrowUpRight, Bookmark, BookmarkPlus, Check, ChevronDown,
  Clipboard, Clock, Download, ExternalLink, FileJson, FileText, Filter, Folder,
  Highlighter, FileUp, Layers, Library, LoaderCircle, LockKeyhole, Pin, Plus,
  Search, Settings, ShieldCheck, Sparkles, Sun, Moon, Tag, Trash2, Undo2, X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Annotation, HighlightColor, LibraryView, DogEarSettings, SelectionPayload, SortOrder } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createBackup, deleteAnnotation, getAnnotations, getPendingSelection, getSettings, parseBackup, replaceAnnotations, saveAnnotation, saveSettings, updateAnnotation, clearPendingSelection } from '../../shared/storage';
import { markdownExport, matchesOriginPattern, normalizePageUrl, originPattern, parseTags } from '../../shared/anchors';

interface EditorValue {
  id?: string;
  url: string;
  pageTitle: string;
  quote: string;
  note: string;
  tags: string;
  collection: string;
  color: HighlightColor;
  anchor?: Annotation['anchor'];
}

const COLOR_NAMES: HighlightColor[] = ['amber', 'blue', 'mint', 'rose', 'violet'];
const workspaceViews: Array<{ id: LibraryView; label: string; icon: LucideIcon }> = [
  { id: 'all', label: 'All notes', icon: Library },
  { id: 'pinned', label: 'Pinned', icon: Pin },
  { id: 'archived', label: 'Archive', icon: Archive }
];

function hostname(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; }
}
function dateLabel(value: number): string {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? `Today · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function emptyEditor(settings: DogEarSettings, source?: SelectionPayload | null): EditorValue {
  return {
    url: source?.url ?? '', pageTitle: source?.pageTitle ?? '', quote: source?.quote ?? '',
    note: '', tags: '', collection: '', color: settings.defaultColor, anchor: source?.anchor
  };
}
function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useDialogFocus<T extends HTMLElement>() {
  const dialogRef = useRef<T>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const getFocusable = () => [...dialog.querySelectorAll<HTMLElement>(selector)].filter((element) => element.getClientRects().length > 0);
    getFocusable()[0]?.focus();

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', keepFocusInside);
      previousFocus?.focus();
    };
  }, []);
  return dialogRef;
}

export function Workspace() {
  const [items, setItems] = useState<Annotation[]>([]);
  const [settings, setSettings] = useState<DogEarSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<LibraryView>('all');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorValue | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState('');
  const [undoItem, setUndoItem] = useState<Annotation | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [annotations, currentSettings] = await Promise.all([getAnnotations(), getSettings()]);
    setItems(annotations);
    setSettings(currentSettings);
    setSelectedId((current) => current && annotations.some((item) => item.id === current) ? current : annotations[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      const pending = await getPendingSelection<SelectionPayload>();
      if (pending) { setEditor(emptyEditor(await getSettings(), pending)); await clearPendingSelection(); }
      setLoading(false);
    })();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && (changes['dogear:annotations:v1'] || changes['dogear:settings:v1'])) void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const collections = useMemo(() => [...new Set(items.map((item) => item.collection.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)), [items]);
  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();
    return items.filter((item) => {
      if (view === 'pinned' && (!item.pinned || item.archived)) return false;
      if (view === 'archived' && !item.archived) return false;
      if (view === 'all' && item.archived) return false;
      if (tagFilter && !item.tags.includes(tagFilter)) return false;
      if (collectionFilter && item.collection !== collectionFilter) return false;
      if (!search) return true;
      return [item.note, item.quote, item.pageTitle, item.url, item.collection, ...item.tags].join(' ').toLowerCase().includes(search);
    }).sort((a, b) => {
      if (sort === 'oldest') return a.createdAt - b.createdAt;
      if (sort === 'updated') return b.updatedAt - a.updatedAt;
      if (sort === 'site') return hostname(a.url).localeCompare(hostname(b.url));
      return b.createdAt - a.createdAt;
    });
  }, [items, view, tagFilter, collectionFilter, query, sort]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && !filteredItems.some((item) => item.id === selectedId)) setSelectedId(filteredItems[0]?.id ?? null);
  }, [filteredItems, selectedId]);
  const activeCount = items.filter((item) => !item.archived).length;
  const pinnedCount = items.filter((item) => item.pinned && !item.archived).length;
  const archiveCount = items.filter((item) => item.archived).length;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = settings.theme === 'system'
        ? (media.matches ? 'dark' : 'light')
        : settings.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); }
      else if (!isTyping && !editor && !showSettings && event.key.toLowerCase() === 'n') { event.preventDefault(); void startNewEditor(); }
      else if (event.key === 'Escape') { setEditor(null); setShowSettings(false); setShowExportMenu(false); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function startNewEditor() {
    const latest = await getSettings();
    const params = new URLSearchParams(window.location.search);
    const sourceUrl = params.get('source');
    const sourceTitle = params.get('title') ?? '';
    if (sourceUrl && (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://'))) {
      setEditor(emptyEditor(latest, {
        quote: '', anchor: { version: 1, exact: '', prefix: '', suffix: '' },
        url: sourceUrl.split('#')[0], pageTitle: sourceTitle
      }));
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const source: SelectionPayload | null = tab?.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://')) ? {
      quote: '', anchor: { version: 1, exact: '', prefix: '', suffix: '' }, url: tab.url.split('#')[0], pageTitle: tab.title ?? ''
    } : null;
    setEditor(emptyEditor(latest, source));
  }

  async function refreshAuthorizedHighlights() {
    try { await chrome.runtime.sendMessage({ type: 'DOGEAR_REFRESH_ACTIVE_HIGHLIGHTS' }); } catch { /* Background worker may be restarting. */ }
  }

  async function submitEditor(value: EditorValue) {
    if (!value.url.trim()) { setToast('Add a source URL to save this note.'); return; }
    let parsedUrl: URL;
    try { parsedUrl = new URL(value.url.trim()); if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error(); }
    catch { setToast('Enter a valid http or https source URL.'); return; }
    if (!value.note.trim() && !value.quote.trim()) { setToast('Add a thought or a passage before saving.'); return; }
    const now = Date.now();
    const annotation: Annotation = {
      id: value.id ?? crypto.randomUUID(), url: normalizePageUrl(parsedUrl.toString()), pageTitle: value.pageTitle.trim() || parsedUrl.hostname,
      quote: value.quote.trim(), ...(value.quote.trim() ? { anchor: value.anchor?.exact === value.quote.trim() ? value.anchor : { version: 1 as const, exact: value.quote.trim(), prefix: '', suffix: '' } } : {}),
      note: value.note.trim(), tags: parseTags(value.tags), collection: value.collection.trim().slice(0, 60),
      color: value.color, pinned: selected && selected.id === value.id ? selected.pinned : false, archived: selected && selected.id === value.id ? selected.archived : false,
      createdAt: value.id ? (items.find((item) => item.id === value.id)?.createdAt ?? now) : now, updatedAt: now
    };
    try {
      await saveAnnotation(annotation);
      setEditor(null); setSelectedId(annotation.id); await refresh(); await refreshAuthorizedHighlights();
      setToast(value.id ? 'Note updated.' : 'Added to DogEar.');
    } catch {
      setToast('The note could not be saved. Export a DogEar backup if browser storage is full, then try again.');
    }
  }

  async function toggleField(item: Annotation, field: 'pinned' | 'archived') {
    await updateAnnotation(item.id, { [field]: !item[field] });
    await refresh(); await refreshAuthorizedHighlights();
    setToast(field === 'pinned' ? (!item.pinned ? 'Pinned for later.' : 'Removed from pinned.') : (!item.archived ? 'Moved to archive.' : 'Restored to your library.'));
  }

  async function removeItem(item: Annotation) {
    await deleteAnnotation(item.id); setUndoItem(item); await refresh(); await refreshAuthorizedHighlights(); setToast('Note deleted.');
    window.setTimeout(() => setUndoItem((current) => current?.id === item.id ? null : current), 7000);
  }

  async function undoDelete() {
    if (!undoItem) return;
    await saveAnnotation(undoItem); setUndoItem(null); await refresh(); await refreshAuthorizedHighlights(); setSelectedId(undoItem.id); setToast('Deletion undone.');
  }

  async function openSource(item: Annotation, highlight: boolean) {
    if (highlight) {
      const pattern = originPattern(item.url);
      if (pattern) {
        // Request inside the click gesture; the promise resolves immediately when already granted.
        const granted = await chrome.permissions.request({ origins: [pattern] });
        if (granted) {
          const current = await getSettings(); current.enabledOrigins = [...new Set([...current.enabledOrigins, pattern])];
          await saveSettings(current); setSettings(current);
        }
      }
    }
    await chrome.tabs.create({ url: item.url });
  }

  async function exportJson() {
    const backup = await createBackup();
    downloadFile(`dogear-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
    setShowExportMenu(false); setToast('JSON backup exported.');
  }
  async function exportMarkdown() {
    downloadFile(`dogear-notes-${new Date().toISOString().slice(0, 10)}.md`, markdownExport(items), 'text/markdown;charset=utf-8');
    setShowExportMenu(false); setToast('Markdown export downloaded.');
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setImportMessage('This backup is larger than DogEar’s 8 MB import limit.');
      if (importRef.current) importRef.current.value = '';
      return;
    }
    setImporting(true); setImportMessage('');
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      const existing = await getAnnotations();
      const merged = new Map(existing.map((item) => [item.id, item]));
      parsed.forEach((item) => merged.set(item.id, item));
      await replaceAnnotations([...merged.values()]);
      await refresh(); await refreshAuthorizedHighlights(); setImportMessage(`Imported ${parsed.length} note${parsed.length === 1 ? '' : 's'}.`); setToast('Backup imported successfully.');
    } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Could not read this backup.'); }
    finally { setImporting(false); if (importRef.current) importRef.current.value = ''; }
  }

  async function updatePreference(changes: Partial<DogEarSettings>) {
    const next = { ...settings, ...changes };
    await saveSettings(next); setSettings(next);
    if (changes.showPageHighlights !== undefined) {
      void chrome.runtime.sendMessage({ type: 'DOGEAR_REFRESH_ACTIVE_HIGHLIGHTS' }).catch(() => undefined);
    }
  }

  async function revokeOrigin(pattern: string) {
    const tabs = await chrome.tabs.query({});
    const matchingTabIds = tabs.filter((tab) => tab.id && tab.url && matchesOriginPattern(pattern, tab.url))
      .map((tab) => tab.id as number);
    const removed = await chrome.permissions.remove({ origins: [pattern] });
    if (!removed) { setToast('Chrome did not remove that site permission.'); return; }
    await Promise.all(matchingTabIds.map((tabId) => chrome.tabs.sendMessage(tabId, { type: 'DOGEAR_CLEAR_HIGHLIGHTS' }).catch(() => undefined)));
    const next = { ...settings, enabledOrigins: settings.enabledOrigins.filter((origin) => origin !== pattern) };
    await saveSettings(next); setSettings(next); setToast('Site access removed.');
  }

  async function clearLibrary() {
    await replaceAnnotations([]);
    await clearPendingSelection();
    setUndoItem(null); setSelectedId(null); await refresh(); await refreshAuthorizedHighlights();
    setToast('Your local DogEar library has been cleared.');
  }

  const empty = filteredItems.length === 0;

  return <div className="workspace-shell">
    <aside className="sidebar">
      <div className="workspace-logo"><div className="workspace-mark">d</div><div><b>dogear<span>.</span></b><small>YOUR PERSONAL WEB ANNOTATIONS</small></div></div>
      <button className="sidebar-new" onClick={() => void startNewEditor()}><Plus size={16}/> New note <kbd>N</kbd></button>
      <div className="sidebar-label">LIBRARY</div>
      <nav className="sidebar-nav" aria-label="Library views">
        {workspaceViews.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setSelectedId(null); }}><Icon size={16}/><span>{label}</span><small>{id === 'all' ? activeCount : id === 'pinned' ? pinnedCount : archiveCount}</small></button>)}
      </nav>
      {collections.length > 0 && <><div className="sidebar-label sidebar-label-spaced">COLLECTIONS <button title="Create a note and assign it to a collection" onClick={() => void startNewEditor()}><Plus size={13}/></button></div><div className="sidebar-collections"><button className={collectionFilter === '' ? 'chosen' : ''} onClick={() => setCollectionFilter('')}><Layers size={14}/> All collections</button>{collections.map((name) => <button key={name} className={collectionFilter === name ? 'chosen' : ''} onClick={() => { setCollectionFilter(name); setView('all'); }}><Folder size={14}/><span>{name}</span></button>)}</div></>}
      {tags.length > 0 && <><div className="sidebar-label sidebar-label-spaced">YOUR TAGS</div><div className="sidebar-tags">{tags.slice(0, 16).map((tag) => <button key={tag} className={tagFilter === tag ? 'chosen' : ''} onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}>#{tag}</button>)}</div></>}
      <div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck size={16}/><div><b>Private by design</b><small>Your notes stay on this device.</small></div></div><button className="settings-link" onClick={() => setShowSettings(true)}><Settings size={16}/> Settings <span>⌘,</span></button></div>
    </aside>

    <main className="library-main">
      <header className="main-header">
        <div><div className="breadcrumb">YOUR SPACE <span>/</span> {view === 'all' ? 'ALL NOTES' : view.toUpperCase()}</div><h1>{view === 'all' ? 'Your notes' : view === 'pinned' ? 'Pinned thoughts' : 'The archive'}<span>.</span></h1><p>{view === 'all' ? 'The ideas, passages, and little observations you chose to keep.' : view === 'pinned' ? 'The thoughts you want close at hand.' : 'Things you are keeping, just not carrying every day.'}</p></div>
        <div className="header-actions"><div className="export-wrap"><button className="outline-button" onClick={() => setShowExportMenu((value) => !value)}><Download size={15}/> Export <ChevronDown size={13}/></button>{showExportMenu && <div className="export-menu"><button onClick={() => void exportJson()}><FileJson size={15}/> Backup as JSON</button><button onClick={() => void exportMarkdown()}><FileText size={15}/> Export as Markdown</button></div>}</div><button className="dark-button" onClick={() => void startNewEditor()}><Plus size={16}/> New note</button></div>
      </header>

      <section className="stats-row"><div className="stat-card"><span>TOTAL SAVED</span><b>{activeCount.toString().padStart(2, '0')}</b><small>notes in your library</small></div><div className="stat-card"><span>PINNED</span><b>{pinnedCount.toString().padStart(2, '0')}</b><small>worth revisiting soon</small></div><div className="stat-card"><span>COLLECTIONS</span><b>{collections.length.toString().padStart(2, '0')}</b><small>ways you organize ideas</small></div><div className="stat-card stat-quote"><Sparkles size={16}/><p>“A thought is only useful when you can find it again.”</p><small>THE DOGEAR PRINCIPLE</small></div></section>

      <section className="library-toolbar"><div className="search-box"><Search size={16}/><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search passages, thoughts, sites…"/><kbd>Ctrl K</kbd></div><button className={`filter-button ${showFilters || tagFilter || collectionFilter ? 'filter-active' : ''}`} onClick={() => setShowFilters((value) => !value)}><Filter size={15}/> Filters {(tagFilter || collectionFilter) && <i/>}</button><label className="sort-select"><ArrowDownUp size={14}/><select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)} aria-label="Sort notes"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently updated</option><option value="site">By website</option></select><ChevronDown size={12}/></label></section>
      {showFilters && <section className="filter-tray"><label>Tag<select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Every tag</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label><label>Collection<select value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}><option value="">Every collection</option>{collections.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><button onClick={() => { setTagFilter(''); setCollectionFilter(''); }}>Clear filters</button></section>}

      <div className="list-caption"><span>{query ? `${filteredItems.length} SEARCH RESULTS` : `${filteredItems.length} ${filteredItems.length === 1 ? 'NOTE' : 'NOTES'}`}</span><span>{sort === 'newest' ? 'RECENTLY ADDED' : sort.replace('-', ' ').toUpperCase()}</span></div>
      {loading ? <div className="workspace-loading"><LoaderCircle className="spin"/> Loading your library…</div> : empty ? <div className="empty-library"><div className="empty-illustration"><BookmarkPlus size={27}/></div><h2>{query || tagFilter || collectionFilter ? 'Nothing matches just yet.' : view === 'archived' ? 'Your archive is empty.' : 'A clean page.'}</h2><p>{query || tagFilter || collectionFilter ? 'Try another search or clear the filters.' : 'When you find a passage worth keeping, save it as a note of its own.'}</p>{query || tagFilter || collectionFilter ? <button className="outline-button" onClick={() => { setQuery(''); setTagFilter(''); setCollectionFilter(''); }}>Clear search and filters</button> : <button className="dark-button" onClick={() => void startNewEditor()}><Plus size={15}/> Create your first note</button>}</div> : <div className="annotation-grid">{filteredItems.map((item) => <article key={item.id} role="button" aria-pressed={selectedId === item.id} aria-label={`Open note from ${hostname(item.url)}: ${item.quote || item.note}`} className={`dogear-card ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.id); } }}>
        <div className="card-top"><span className="site-favicon">{hostname(item.url).slice(0, 1).toUpperCase()}</span><span className="site-name">{hostname(item.url)}</span><span className="card-date">{dateLabel(item.createdAt)}</span>{item.pinned && <Pin size={13} className="pinned-icon"/>}</div>
        {item.quote ? <blockquote className={`card-quote color-${item.color}`}>“{item.quote}”</blockquote> : <div className="page-note-label"><Bookmark size={13}/> PAGE NOTE</div>}
        <p className="card-note">{item.note || 'No additional thought attached.'}</p>
        <div className="card-bottom">{item.tags.slice(0, 3).map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}{item.collection && <span className="collection-chip"><Folder size={10}/>{item.collection}</span>}<span className="card-open"><ArrowUpRight size={14}/></span></div>
      </article>)}</div>}
      <footer className="main-footer"><span>MADE FOR THE CURIOUS</span><span>YOUR THOUGHTS ARE YOURS. ALWAYS.</span></footer>
    </main>

    <aside className="detail-pane">
      {selected ? <>
        <div className="detail-topline"><span>YOUR NOTE</span><button onClick={() => setSelectedId(null)} aria-label="Close details"><X size={16}/></button></div>
        <div className="detail-site"><div className="detail-favicon">{hostname(selected.url).slice(0, 1).toUpperCase()}</div><div><b>{hostname(selected.url)}</b><small>{selected.pageTitle || selected.url}</small></div><a href={selected.url} target="_blank" rel="noreferrer" aria-label="Open source in a new tab"><ExternalLink size={14}/></a></div>
        <div className="detail-date"><Clock size={13}/> Saved {dateLabel(selected.createdAt).toLowerCase()}{selected.updatedAt > selected.createdAt + 1000 && <span> · edited</span>}</div>
        {selected.quote ? <section className="detail-passage"><div className="detail-label"><Highlighter size={13}/> SAVED PASSAGE</div><blockquote className={`detail-quote color-${selected.color}`}>“{selected.quote}”</blockquote><div className="detail-anchor-state"><Check size={12}/> Passage anchor stored</div></section> : <section className="detail-passage"><div className="detail-label"><Bookmark size={13}/> PAGE NOTE</div><p className="no-passage">This note is attached to the page, not a selected passage.</p></section>}
        <section className="detail-thought"><div className="detail-label">YOUR THOUGHT</div><p>{selected.note || 'No thought added.'}</p></section>
        {selected.tags.length > 0 && <section className="detail-section"><div className="detail-label"><Tag size={13}/> TAGS</div><div className="detail-tags">{selected.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div></section>}
        {selected.collection && <section className="detail-section"><div className="detail-label"><Folder size={13}/> COLLECTION</div><span className="detail-collection">{selected.collection}</span></section>}
        <div className="detail-actions"><button className="detail-primary" onClick={() => void openSource(selected, Boolean(selected.anchor?.exact))}><ArrowUpRight size={15}/> {selected.anchor?.exact ? 'Open & highlight passage' : 'Open original page'}</button><button className="detail-edit" onClick={() => setEditor({ id: selected.id, url: selected.url, pageTitle: selected.pageTitle, quote: selected.quote, note: selected.note, tags: selected.tags.join(', '), collection: selected.collection, color: selected.color, anchor: selected.anchor })}>Edit note</button><div className="detail-action-row"><button onClick={() => void toggleField(selected, 'pinned')}><Pin size={14}/> {selected.pinned ? 'Unpin' : 'Pin'}</button><button onClick={() => void toggleField(selected, 'archived')}><Archive size={14}/> {selected.archived ? 'Restore' : 'Archive'}</button><button className="danger-action" onClick={() => void removeItem(selected)}><Trash2 size={14}/> Delete</button></div></div>
        <div className="detail-private"><LockKeyhole size={13}/> Stored locally in this browser.</div>
      </> : <div className="detail-empty"><div className="detail-empty-icon"><Clipboard size={22}/></div><b>Pick a note to read it closer.</b><p>Your saved passage and the thought behind it will appear here.</p></div>}
    </aside>

    {editor && <EditorModal value={editor} onClose={() => { setEditor(null); }} onSave={(value) => void submitEditor(value)}/>}
    {showSettings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onChange={(changes) => void updatePreference(changes)} onRevoke={(pattern) => void revokeOrigin(pattern)} onImport={() => importRef.current?.click()} onClearAll={() => void clearLibrary()} importMessage={importMessage} importing={importing}/ >}
    <input ref={importRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => void importFile(event.target.files?.[0])}/>
    {toast && <div className="toast" role="status"><Check size={15}/>{toast}{undoItem && <button onClick={() => void undoDelete()}><Undo2 size={13}/> Undo</button>}<button className="toast-close" aria-label="Dismiss" onClick={() => { setToast(''); setUndoItem(null); }}><X size={13}/></button></div>}
  </div>;
}

function EditorModal({ value, onClose, onSave }: { value: EditorValue; onClose: () => void; onSave: (value: EditorValue) => void }) {
  const dialogRef = useDialogFocus<HTMLFormElement>();
  const [form, setForm] = useState<EditorValue>(value);
  const [error, setError] = useState('');
  const set = <K extends keyof EditorValue>(key: K, next: EditorValue[K]) => setForm((current) => ({ ...current, [key]: next }));
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form ref={dialogRef} className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-dialog-title" onSubmit={(event) => { event.preventDefault(); if (!form.note.trim() && !form.quote.trim()) { setError('Add a note or passage before saving.'); return; } onSave(form); }}>
    <header className="modal-header"><div><span className="eyebrow">{form.id ? 'REFINE YOUR THOUGHT' : 'A NEW NOTE'}</span><h2 id="editor-dialog-title">{form.id ? 'Edit note' : 'Keep something worth keeping.'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close editor"><X size={17}/></button></header>
    <div className="editor-fields"><label>Source URL<input required type="url" value={form.url} onChange={(event) => { set('url', event.target.value); if (event.target.value.trim() !== value.url) set('anchor', undefined); }} placeholder="https://example.com/article"/></label><label>Page title<input value={form.pageTitle} onChange={(event) => set('pageTitle', event.target.value)} placeholder="A useful article, a good read…"/></label><label>Passage <span>OPTIONAL</span><textarea rows={3} value={form.quote} onChange={(event) => { set('quote', event.target.value); if (event.target.value !== value.quote) set('anchor', undefined); }} placeholder="Paste the passage you want to remember"/></label><label>Your thought<textarea rows={4} value={form.note} onChange={(event) => set('note', event.target.value)} placeholder="Why does this matter? What did it make you think?"/></label><div className="form-two-col"><label>Tags<input value={form.tags} onChange={(event) => set('tags', event.target.value)} placeholder="design, research, ideas"/></label><label>Collection<input value={form.collection} onChange={(event) => set('collection', event.target.value)} placeholder="A collection name"/></label></div><div className="editor-color-row"><span>PASSAGE COLOR</span>{COLOR_NAMES.map((color) => <button type="button" key={color} className={`color-dot ${color} ${form.color === color ? 'selected' : ''}`} onClick={() => set('color', color)} aria-label={`${color} color`} aria-pressed={form.color === color}/>)}</div>{error && <p className="form-error">{error}</p>}</div>
    <footer className="modal-footer"><span><LockKeyhole size={12}/> Stays on this device</span><div><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button type="submit" className="dark-button"><Check size={15}/> Save note</button></div></footer>
  </form></div>;
}

function SettingsModal({ settings, onClose, onChange, onRevoke, onImport, onClearAll, importMessage, importing }: { settings: DogEarSettings; onClose: () => void; onChange: (changes: Partial<DogEarSettings>) => void; onRevoke: (pattern: string) => void; onImport: () => void; onClearAll: () => void; importMessage: string; importing: boolean }) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [confirmClear, setConfirmClear] = useState(false);
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
    <header className="modal-header"><div><span className="eyebrow">MAKE IT YOURS</span><h2 id="settings-dialog-title">DogEar settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={17}/></button></header>
    <div className="settings-content"><section className="settings-section"><h3>Appearance</h3><p>Choose how your workspace feels.</p><div className="theme-options">{(['light', 'dark', 'system'] as const).map((theme) => <button key={theme} className={settings.theme === theme ? 'active' : ''} onClick={() => onChange({ theme })}>{theme === 'light' ? <Sun size={15}/> : theme === 'dark' ? <Moon size={15}/> : <Sparkles size={15}/>} {theme[0].toUpperCase() + theme.slice(1)}</button>)}</div></section>
      <section className="settings-section"><h3>Highlights</h3><p>Revisit saved passages automatically on sites you explicitly allow.</p><label className="toggle-row"><span><b>Show passage highlights</b><small>Use a subtle mark when a saved passage is found.</small></span><input type="checkbox" checked={settings.showPageHighlights} onChange={(event) => onChange({ showPageHighlights: event.target.checked })}/></label><label className="default-color-row">Default highlight color<select value={settings.defaultColor} onChange={(event) => onChange({ defaultColor: event.target.value as HighlightColor })}>{COLOR_NAMES.map((color) => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}</select></label>
      <div className="site-access"><div className="site-access-heading"><b>Sites with access</b><small>Only these websites can be checked for saved passages.</small></div>{settings.enabledOrigins.length === 0 ? <div className="no-sites">No sites have been granted persistent access.</div> : settings.enabledOrigins.map((pattern) => <div className="site-row" key={pattern}><span><ShieldCheck size={13}/>{pattern.replace(/\/\*$/, '')}</span><button onClick={() => onRevoke(pattern)}>Remove access</button></div>)}</div></section>
      <section className="settings-section"><h3>Data & privacy</h3><p>Your library stays in this browser profile. Export a backup before clearing browser data.</p><button className="settings-action" onClick={onImport}><FileUp size={15}/> Import a DogEar JSON backup</button>{importing && <div className="settings-feedback"><LoaderCircle className="spin" size={13}/> Importing…</div>}{importMessage && <div className="settings-feedback">{importMessage}</div>}<div className="privacy-note"><LockKeyhole size={14}/><span>DogEar does not send your notes, reading history, or page content to a server. Host access is optional and limited to sites you approve.</span></div><div className="clear-data-row"><div><b>Clear your local library</b><small>Delete all saved notes from this browser. This cannot be undone.</small></div>{confirmClear ? <span className="clear-confirm"><button onClick={() => setConfirmClear(false)}>Cancel</button><button onClick={() => { onClearAll(); setConfirmClear(false); onClose(); }}>Delete all</button></span> : <button onClick={() => setConfirmClear(true)}>Clear library</button>}</div></section>
      <section className="settings-section"><h3>Keyboard shortcuts</h3><div className="shortcut-row"><span>Open DogEar workspace</span><kbd>Alt</kbd><b>+</b><kbd>Shift</kbd><b>+</b><kbd>D</kbd></div><div className="shortcut-row"><span>Search library</span><kbd>Ctrl</kbd><b>+</b><kbd>K</kbd></div><div className="shortcut-row"><span>New note</span><kbd>N</kbd></div><small className="shortcut-footnote">Browser shortcuts can be customized at chrome://extensions/shortcuts.</small></section></div>
    <footer className="modal-footer"><span><ShieldCheck size={13}/> LOCAL BY DESIGN</span><button className="dark-button" onClick={onClose}>Done</button></footer>
  </section></div>;
}
