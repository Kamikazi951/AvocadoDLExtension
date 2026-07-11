/**
 * AvocadoDL — Background Service Worker
 * 
 * Responsibilities:
 * 1. Download handler — triggers page-level fetch or chrome.downloads when user requests download
 * 2. Settings management — synchronizes user options
 */

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  showFloatingButton: true,
  showClipboardPill: true,
  buttonIdle: true,
  idleOpacity: 0.25,
  minVideoDuration: 0,
  floatingButtonSize: 'medium',
  floatingButtonPosition: 'top-right',
  floatingButtonMode: 'full',
  floatingButtonOffset: { x: 0, y: 0 },
  theme: 'dark'
};

let settings = { ...DEFAULT_SETTINGS };

// Load settings on startup
chrome.storage.sync.get('settings', (result) => {
  if (result.settings) {
    settings = { ...DEFAULT_SETTINGS, ...result.settings };
  }
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  }
});

function prepareDownloadUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const isSocial = hostname.includes('instagram.com') ||
                     hostname.includes('twitter.com') ||
                     hostname.includes('x.com') ||
                     hostname.includes('tiktok.com') ||
                     hostname.includes('reddit.com') ||
                     hostname.includes('facebook.com') ||
                     hostname.includes('youtube.com') ||
                     hostname.includes('youtu.be');
    
    if (isSocial) {
      // Append the FDM integration GUID to trigger FDM's native onBeforeRequest interceptor.
      // This routes the page URL directly to FDM and cancels the browser's HTML download.
      const separator = url.includes('?') ? '&' : '?';
      return url + separator + 'fdmguid=6d36f5b5519148d69647a983ebd677fc';
    }
  } catch (e) {
    // Fallback if URL is invalid
  }
  return url;
}

// ─── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    
    // Download a file
    case 'DOWNLOAD': {
      const finalUrl = prepareDownloadUrl(message.url);
      if (finalUrl.includes('fdmguid=')) {
        const tabId = message.tabId || sender.tab?.id;
        const frameId = sender.frameId !== undefined ? sender.frameId : 0;
        if (tabId !== undefined) {
          chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_FDM_FETCH', url: finalUrl }, { frameId }, () => {
            if (chrome.runtime.lastError) {
              fetch(finalUrl, { mode: 'no-cors' }).catch(() => {});
            }
          });
          sendResponse({ ok: true });
        } else {
          fetch(finalUrl, { mode: 'no-cors' }).catch(() => {});
          sendResponse({ ok: true });
        }
      } else {
        chrome.downloads.download({
          url: finalUrl,
          filename: message.filename || undefined,
          saveAs: message.saveAs || false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ downloadId });
          }
        });
      }
      return true; // Keep message channel open for async response
    }
    
    // Download with "Save As" dialog
    case 'DOWNLOAD_AS': {
      const finalUrl = prepareDownloadUrl(message.url);
      if (finalUrl.includes('fdmguid=')) {
        const tabId = message.tabId || sender.tab?.id;
        const frameId = sender.frameId !== undefined ? sender.frameId : 0;
        if (tabId !== undefined) {
          chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_FDM_FETCH', url: finalUrl }, { frameId }, () => {
            if (chrome.runtime.lastError) {
              fetch(finalUrl, { mode: 'no-cors' }).catch(() => {});
            }
          });
          sendResponse({ ok: true });
        } else {
          fetch(finalUrl, { mode: 'no-cors' }).catch(() => {});
          sendResponse({ ok: true });
        }
      } else {
        chrome.downloads.download({
          url: finalUrl,
          filename: message.filename || undefined,
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ downloadId });
          }
        });
      }
      return true;
    }
    
    // Get settings
    case 'GET_SETTINGS': {
      sendResponse({ settings });
      break;
    }
  }
});

// ─── Extension Install / Update ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    console.log('AvocadoDL: Extension installed');
  }
});

console.log('AvocadoDL: Service worker started');
