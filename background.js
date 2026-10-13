/* AvocadoDL Manifest V3 worker. All download entry points use the same routing. */
importScripts('urls.js');

const DEFAULT_SETTINGS = {
  showFloatingButton: true, showClipboardPill: true, buttonIdle: true,
  idleOpacity: 0.25, minVideoDuration: 0, floatingButtonSize: 'medium',
  floatingButtonPosition: 'top-right', floatingButtonMode: 'full',
  floatingButtonOffset: { x: 0, y: 0 }, theme: 'dark'
};
const tabQueues = new Map();

function queueTab(tabId, action) {
  const previous = tabQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  tabQueues.set(tabId, next);
  next.finally(() => { if (tabQueues.get(tabId) === next) tabQueues.delete(tabId); }).catch(() => {});
  return next;
}

async function rememberMedia(message, sender) {
  if (sender.tab?.id === undefined || !AvocadoUrls.httpUrl(message.url)) return;
  const key = 'media:' + sender.tab.id;
  await queueTab(sender.tab.id, async () => {
    const stored = await chrome.storage.session.get(key);
    const items = (stored[key] || []).filter(item => item.url !== message.url);
    items.push({ url: message.url, frameId: sender.frameId || 0,
      pageUrl: sender.url, title: String(message.pageTitle || '').slice(0, 160),
      isDirect: message.isDirect !== false, seenAt: Date.now() });
    await chrome.storage.session.set({ [key]: items.slice(-50) });
  });
}

async function download(message, sender = {}) {
  const target = AvocadoUrls.route(message.url, {
    isDirect: message.isDirect,
    pageUrl: message.pageUrl || sender.url || sender.tab?.url
  });
  if (message.destination !== 'chrome' || target.viaFdm) {
    const fromWebPage = sender.tab && AvocadoUrls.httpUrl(sender.url);
    const tabId = fromWebPage ? sender.tab.id : message.tabId;
    const frameId = fromWebPage ? (sender.frameId ?? 0) : (message.frameId ?? 0);
    if (!Number.isInteger(tabId)) throw new Error('Open the video page and retry from the AvocadoDL toolbar.');
    // Worker-origin requests are invisible to the OTHER extension (FDM).
    // ISOLATED content fetch has the page initiator, bypasses its connect-src
    // CSP, and is visible to FDM's real webRequest listener.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] }, world: 'ISOLATED',
      func: url => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        fetch(url, { mode: 'no-cors', credentials: 'include', cache: 'no-store', signal: controller.signal })
          .then(response => response.body?.cancel())
          .catch(() => {}) // FDM can cancel a request it has intercepted.
          .finally(() => clearTimeout(timer));
      }, args: [AvocadoUrls.fdmUrl(target.url)]
    });
    return { ok: true, status: 'requested', viaFdm: true,
      message: 'Request sent from this page. Check the FDM download dialog. If it does not open, enable the official FDM extension and start FDM.' };
  }
  const downloadId = await chrome.downloads.download({
    url: target.url, saveAs: message.type === 'DOWNLOAD_AS' || message.saveAs === true
  });
  return { ok: true, status: 'started', downloadId, message: 'Download started in Chrome.' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  let operation;
  switch (message.type) {
    case 'DOWNLOAD':
    case 'DOWNLOAD_AS': operation = download(message, sender); break;
    case 'MEDIA_FOUND': operation = rememberMedia(message, sender).then(() => ({ ok: true })); break;
    case 'GET_MEDIA':
      if (!Number.isInteger(message.tabId)) return;
      operation = chrome.storage.session.get('media:' + message.tabId)
        .then(result => ({ items: result['media:' + message.tabId] || [] }));
      break;
    case 'GET_SETTINGS':
      operation = chrome.storage.sync.get('settings')
        .then(result => ({ settings: { ...DEFAULT_SETTINGS, ...result.settings } }));
      break;
    default: return;
  }
  operation.then(sendResponse, error => sendResponse({ error: error.message || 'Download failed. Try again.' }));
  return true;
});

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'avocadodl-download', title: 'Download with AvocadoDL (FDM)',
      contexts: ['video', 'audio', 'link', 'page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'avocadodl-download') return;
  const media = info.mediaType === 'video' || info.mediaType === 'audio';
  const pageUrl = info.frameUrl || info.pageUrl || tab?.url;
  const url = media ? (info.srcUrl || pageUrl) : (info.linkUrl || pageUrl);
  download({ type: 'DOWNLOAD_AS', url, pageUrl, tabId: tab?.id, frameId: info.frameId || 0,
    isDirect: media ? !!info.srcUrl : undefined })
    .then(result => chrome.storage.session.set({ lastDownload: result }))
    .catch(error => chrome.storage.session.set({ lastDownload: { error: error.message } }));
});

chrome.tabs.onRemoved.addListener(tabId => queueTab(tabId, () => chrome.storage.session.remove('media:' + tabId)));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) {
    queueTab(tabId, () => chrome.storage.session.remove('media:' + tabId)).catch(() => {});
  }
});
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, ...stored.settings } });
  setupContextMenu();
});
chrome.runtime.onStartup.addListener(setupContextMenu);
