import { useEffect, useState } from 'react';
import { ArrowUpRight, BookmarkPlus, BookOpen, Check, Command, ExternalLink, Highlighter, Library, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';
import type { Annotation, HighlightColor, SelectionPayload } from '../../shared/types';
import { getAnnotations, getSettings, saveAnnotation, saveSettings } from '../../shared/storage';
import { originPattern, parseTags } from '../../shared/anchors';

const colors: HighlightColor[] = ['amber', 'blue', 'mint', 'rose', 'violet'];
const workspaceUrl = () => chrome.runtime.getURL('workspace.html');
const quickStartUrl = () => chrome.runtime.getURL('QUICK-START.html');

export function Popup() {
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [url, setUrl] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [color, setColor] = useState<HighlightColor>('amber');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissionState, setPermissionState] = useState<'unknown' | 'enabled' | 'disabled' | 'unavailable'>('unknown');
  const [message, setMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const supportedPage = url.startsWith('http://') || url.startsWith('https://');

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) { setUrl(tab.url); setPageTitle(tab.title ?? ''); }
      const [settings, annotations] = await Promise.all([getSettings(), getAnnotations()]);
      setColor(settings.defaultColor);
      setSavedCount(annotations.length);
      const pattern = tab?.url ? originPattern(tab.url) : null;
      if (pattern) setPermissionState(await chrome.permissions.contains({ origins: [pattern] }) ? 'enabled' : 'disabled');
      else setPermissionState('unavailable');
      if (tab?.id) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'DOGEAR_GET_SELECTION' });
          if (response?.ok) setSelection(response.selection as SelectionPayload);
        } catch {
          setMessage('This browser page does not allow capture. Try a regular webpage.');
        }
      }
      setLoading(false);
    })();
  }, []);

  async function save(quickSave = false) {
    if (!quickSave && !note.trim() && !selection?.quote) { setMessage('Add a note or select a passage first.'); return; }
    if (!supportedPage) { setMessage('DogEar can save notes from regular webpages only.'); return; }
    setSaving(true);
    try {
      const now = Date.now();
      const annotation: Annotation = {
        id: crypto.randomUUID(), url: selection?.url ?? url, pageTitle: selection?.pageTitle ?? pageTitle,
        quote: selection?.quote ?? '', ...(selection ? { anchor: selection.anchor } : {}),
        note: note.trim(), tags: parseTags(tags), collection: '', color, pinned: false, archived: false,
        createdAt: now, updatedAt: now
      };
      await saveAnnotation(annotation);
      setSavedCount((count) => count + 1);
      setNote(''); setTags(''); setMessage('');
      setToastVisible(true);
      window.setTimeout(() => setToastVisible(false), 2200);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          const [all, settings] = await Promise.all([getAnnotations(), getSettings()]);
          const pattern = originPattern(annotation.url);
          const persistentAccess = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
          if (settings.showPageHighlights && persistentAccess) {
            await chrome.tabs.sendMessage(tab.id, { type: 'DOGEAR_RENDER_HIGHLIGHTS', annotations: all.filter((item) => item.url === annotation.url && item.anchor && !item.archived) });
          }
        } catch { /* Site may not permit injection. Saving still succeeds. */ }
      }
    } catch {
      setMessage('Could not save this note. Please try again.');
    } finally { setSaving(false); }
  }

  async function enableSiteHighlights() {
    const pattern = originPattern(url);
    if (!pattern) return;
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) { setMessage('Site access was not granted. Your notes are still saved locally.'); return; }
      const settings = await getSettings();
      settings.enabledOrigins = [...new Set([...settings.enabledOrigins, pattern])];
      await saveSettings(settings);
      setPermissionState('enabled');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        if (settings.showPageHighlights) {
          const annotations = await getAnnotations();
          await chrome.tabs.sendMessage(tab.id, { type: 'DOGEAR_RENDER_HIGHLIGHTS', annotations: annotations.filter((item) => item.url === (selection?.url ?? url) && item.anchor && !item.archived) });
        }
      }
      setMessage('Automatic highlighting enabled for this site.');
    } catch { setMessage('Could not enable site access. You can manage permissions in browser settings.'); }
  }

  function openWorkspace() {
    const params = new URLSearchParams();
    const sourceUrl = selection?.url ?? url;
    if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
      params.set('source', sourceUrl);
      params.set('title', selection?.pageTitle ?? pageTitle);
    }
    void chrome.tabs.create({ url: `${workspaceUrl()}${params.toString() ? `?${params.toString()}` : ''}` });
    window.close();
  }

  function openQuickStart() {
    void chrome.tabs.create({ url: quickStartUrl() });
  }

  return <main className="popup-shell">
    <header className="popup-header">
      <img className="popup-brand-logo" src={chrome.runtime.getURL("assets/dogear-128.png")} alt="DogEar logo" />
      <div className="popup-brand"><strong>dogear<span>.</span></strong><small>YOUR THOUGHTS, IN CONTEXT</small></div>
      <div className="popup-saved"><b>{savedCount.toString().padStart(2, '0')}</b><small>SAVED</small></div>
    </header>

    <div className="popup-actions-grid">
      <button className="popup-guide" onClick={openQuickStart}>
        <BookOpen size={15}/><span>Quick guide</span><ExternalLink size={12}/>
      </button>
      <button
        className="popup-quick-save"
        disabled={loading || saving || !supportedPage}
        onClick={() => void save(true)}
      >
        {saving ? <><LoaderCircle size={15} className="spin"/> Saving…</> : <><BookmarkPlus size={15}/><span>Quick save</span></>}
      </button>
    </div>

    <section className="popup-capture">
      <div className="popup-section-label"><BookmarkPlus size={13}/> QUICK CAPTURE <span>01</span></div>
      {loading ? <div className="popup-loading"><LoaderCircle className="spin" size={17}/> Preparing this page…</div> : <>
        {selection?.quote ? <blockquote className="popup-quote">“{selection.quote}”</blockquote> : <div className="popup-no-selection"><Highlighter size={16}/><div><b>No passage selected</b><small>Select text on the webpage to attach an exact passage, or simply save a page-level note.</small></div></div>}
        <div className="popup-source">{pageTitle || url || 'No active webpage'}</div>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What's worth remembering about this?" rows={3}/>
        <div className="popup-tags"><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Add tags, separated by commas" aria-label="Tags"/></div>
        <div className="popup-colors" aria-label="Highlight color">
          <span>MARK</span>
          {colors.map((value) => <button key={value} className={`color-dot ${value} ${color === value ? 'selected' : ''}`} aria-label={`${value} highlight`} aria-pressed={color === value} onClick={() => setColor(value)}/>) }
        </div>
        <button className="popup-primary" disabled={saving || (!note.trim() && !selection?.quote) || !supportedPage} onClick={() => void save()}>
          {saving ? <><LoaderCircle size={15} className="spin"/> Saving…</> : <><span>Save to DogEar</span><ArrowUpRight size={16}/></>}
        </button>
      </>}
      {!loading && !supportedPage && <p className="popup-message" role="status">DogEar can capture normal HTTP and HTTPS webpages, not browser-internal pages.</p>}
      {message && <p className="popup-message" role="status">{message}</p>}
    </section>

    <section className="popup-permission">
      <div className="permission-icon"><LockKeyhole size={15}/></div>
      <div className="permission-copy"><b>Bring highlights back on this site</b><small>{permissionState === 'enabled' ? 'Automatic highlighting is enabled here.' : permissionState === 'unavailable' ? 'Unavailable on protected browser pages.' : 'Optional access. Only this site, never your whole browser.'}</small></div>
      {permissionState === 'disabled' && <button onClick={() => void enableSiteHighlights()}>Enable</button>}
      {permissionState === 'enabled' && <Check size={16} className="permission-check"/>}
    </section>

    <button className="popup-workspace" onClick={openWorkspace}><Library size={16}/><span>Open your full library</span><ExternalLink size={13}/></button>
    <div className="popup-intro">
      <span className="eyebrow"><Sparkles size={11}/> A LITTLE SPACE TO THINK</span>
      <h1>Keep the thought.<br/><em>Not just the tab.</em></h1>
      <p><strong>Save a passage, add your perspective, and come back to it when it matters.</strong></p>
    </div>

    <footer className="popup-footer"><span>LOCAL BY DESIGN</span><span><Command size={10}/> ALT + SHIFT + Z</span></footer>
    {toastVisible && <div className="popup-toast" role="status" aria-live="polite"><Check size={16} strokeWidth={3}/> <span>Saved</span></div>}
  </main>;
}
