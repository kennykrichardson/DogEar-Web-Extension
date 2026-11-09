import type { SelectionPayload } from '../shared/types';
import { getAnnotations, getSettings, saveSettings, setPendingSelection } from '../shared/storage';
import { annotationsForUrl, matchesOriginPattern, normalizePageUrl, originPattern } from '../shared/anchors';

const MENU_ID = 'dogear-save-selection';

function workspaceUrl(): string {
  return chrome.runtime.getURL('workspace.html');
}

async function openWorkspace(query = ''): Promise<void> {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.url?.startsWith('http://') || activeTab?.url?.startsWith('https://')) {
    params.set('source', activeTab.url.split('#')[0]);
    params.set('title', activeTab.title ?? '');
  }
  const queryString = params.toString();
  const suffix = queryString ? `?${queryString}` : '';
  await chrome.tabs.create({ url: `${workspaceUrl()}${suffix}` });
}

async function injectAndHighlight(tabId: number, url: string): Promise<void> {
  const pattern = originPattern(url);
  if (!pattern) return;
  const hasAccess = await chrome.permissions.contains({ origins: [pattern] });
  if (!hasAccess) {
    // A single-page app can change origins without replacing its document. If our
    // isolated content helper is still present, remove marks from the previous route.
    try { await chrome.tabs.sendMessage(tabId, { type: 'DOGEAR_CLEAR_HIGHLIGHTS' }); } catch { /* No helper is present on this page. */ }
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'], world: 'ISOLATED' });
    const [annotations, settings] = await Promise.all([getAnnotations(), getSettings()]);
    if (!settings.showPageHighlights) {
      await chrome.tabs.sendMessage(tabId, { type: 'DOGEAR_CLEAR_HIGHLIGHTS' });
      return;
    }
    const matched = annotationsForUrl(annotations, url).filter((item) => !item.archived);
    await chrome.tabs.sendMessage(tabId, { type: 'DOGEAR_RENDER_HIGHLIGHTS', annotations: matched });
  } catch {
    // Restricted browser pages and navigations can reject injection. This is expected.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Save selection to DogEar',
      contexts: ['selection']
    });
  });
  // Repaint already-open pages after an extension update when site access persists.
  void chrome.tabs.query({}).then((tabs) => Promise.all(
    tabs.filter((tab) => tab.id && tab.url).map((tab) => injectAndHighlight(tab.id!, tab.url!))
  ));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.url || !info.selectionText?.trim()) return;
  let payload: SelectionPayload = {
    quote: info.selectionText.trim(),
    anchor: { version: 1, exact: info.selectionText.trim(), prefix: '', suffix: '' },
    url: normalizePageUrl(tab.url),
    pageTitle: tab.title ?? ''
  };
  if (tab.id) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'], world: 'ISOLATED' });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'DOGEAR_GET_SELECTION' });
      if (response?.ok && response.selection?.quote) payload = response.selection as SelectionPayload;
    } catch { /* The context-menu selection remains a valid fallback anchor. */ }
  }
  await setPendingSelection(payload);

  // A context-menu save must open the normal extension popup, never the library.
  // The popup's existing capture flow reads the active tab selection.
  try {
    await chrome.action.openPopup();
  } catch (error) {
    // Do not silently redirect users to the full workspace. If the browser
    // cannot open the popup from this context-menu invocation, leave the
    // selection pending and let the user open DogEar from the toolbar.
    console.warn('DogEar could not open its popup from the context menu.', error);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-dogear') {
    await openWorkspace();
    return;
  }
  if (command === 'capture-selection') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url) { await openWorkspace(); return; }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'], world: 'ISOLATED' });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'DOGEAR_GET_SELECTION' });
      if (response?.ok) await setPendingSelection(response.selection);
      await openWorkspace(response?.ok ? '?capture=pending' : '');
    } catch {
      await openWorkspace();
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if ((changeInfo.status === 'complete' || changeInfo.url) && tab.url) void injectAndHighlight(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'DOGEAR_REFRESH_ACTIVE_HIGHLIGHTS') {
    void (async () => {
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.filter((tab) => tab.id && tab.url && originPattern(tab.url))
        .map((tab) => injectAndHighlight(tab.id!, tab.url!)));
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});

chrome.permissions.onRemoved.addListener((removed) => {
  if (!removed.origins?.length) return;
  void (async () => {
    const settings = await getSettings();
    settings.enabledOrigins = settings.enabledOrigins.filter((origin) => !removed.origins?.includes(origin));
    await saveSettings(settings);

    // Removing persistent permission should also remove marks from tabs already open.
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter((tab) => tab.id && tab.url && removed.origins?.some((pattern) => matchesOriginPattern(pattern, tab.url!)))
      .map((tab) => chrome.tabs.sendMessage(tab.id!, { type: 'DOGEAR_CLEAR_HIGHLIGHTS' }).catch(() => undefined))); 
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter((tab) => tab.id && tab.url).map((tab) => injectAndHighlight(tab.id!, tab.url!)));
  })();
});
