(function() {
  'use strict';

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

  const btnFullSettings = document.getElementById('btn-full-settings');
  const floatingButtonEl = document.getElementById('floating-button');
  const floatingButtonModeEls = document.querySelectorAll('input[name="floating-button-mode"]');
  const floatingButtonSizeEls = document.querySelectorAll('input[name="floating-button-size"]');
  const floatingButtonPositionEl = document.getElementById('floating-button-position');
  const clipboardPillEl = document.getElementById('clipboard-pill');
  const buttonIdleEl = document.getElementById('button-idle');
  const idleOpacityEl = document.getElementById('idle-opacity');
  const idleOpacityValueEl = document.getElementById('idle-opacity-value');
  const minVideoDurationEl = document.getElementById('min-video-duration');
  const resetPositionBtn = document.getElementById('btn-reset-position');

  function getSelectedMode() {
    for (const el of floatingButtonModeEls) {
      if (el.checked) return el.value;
    }
    return 'full';
  }

  function getSelectedSize() {
    for (const el of floatingButtonSizeEls) {
      if (el.checked) return el.value;
    }
    return 'medium';
  }

  function loadSettings() {
    chrome.storage.sync.get('settings', (result) => {
      const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
      floatingButtonEl.checked = settings.showFloatingButton;
      clipboardPillEl.checked = settings.showClipboardPill !== false;
      buttonIdleEl.checked = settings.buttonIdle !== false;
      idleOpacityEl.value = Math.round((settings.idleOpacity ?? 0.25) * 100);
      idleOpacityValueEl.textContent = idleOpacityEl.value + '%';
      minVideoDurationEl.value = settings.minVideoDuration || 0;

      const mode = settings.floatingButtonMode || 'full';
      for (const el of floatingButtonModeEls) {
        el.checked = (el.value === mode);
      }

      const size = settings.floatingButtonSize || 'medium';
      for (const el of floatingButtonSizeEls) {
        el.checked = (el.value === size);
      }

      floatingButtonPositionEl.value = settings.floatingButtonPosition || 'top-right';
    });
  }

  function saveSettings() {
    chrome.storage.sync.get('settings', (result) => {
      const settings = {
        ...DEFAULT_SETTINGS,
        ...(result.settings || {}),
        showFloatingButton: floatingButtonEl.checked,
        showClipboardPill: clipboardPillEl.checked,
        buttonIdle: buttonIdleEl.checked,
        idleOpacity: parseInt(idleOpacityEl.value) / 100,
        minVideoDuration: parseInt(minVideoDurationEl.value),
        floatingButtonSize: getSelectedSize(),
        floatingButtonPosition: floatingButtonPositionEl.value,
        floatingButtonMode: getSelectedMode(),
        theme: 'dark'
      };
      chrome.storage.sync.set({ settings });
    });
  }

  btnFullSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  floatingButtonEl.addEventListener('change', saveSettings);
  clipboardPillEl.addEventListener('change', saveSettings);
  buttonIdleEl.addEventListener('change', saveSettings);
  idleOpacityEl.addEventListener('input', () => {
    idleOpacityValueEl.textContent = idleOpacityEl.value + '%';
    saveSettings();
  });
  minVideoDurationEl.addEventListener('change', saveSettings);
  floatingButtonPositionEl.addEventListener('change', saveSettings);
  floatingButtonModeEls.forEach((el) => el.addEventListener('change', saveSettings));
  floatingButtonSizeEls.forEach((el) => el.addEventListener('change', saveSettings));

  if (resetPositionBtn) {
    resetPositionBtn.addEventListener('click', () => {
      chrome.storage.sync.get('settings', (result) => {
        const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
        settings.floatingButtonOffset = { x: 0, y: 0 };
        chrome.storage.sync.set({ settings });
      });
    });
  }

  const status = document.getElementById('download-status');
  async function requestDownload(button, target) {
    button.disabled = true;
    status.textContent = 'Requesting download…';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_AS', ...target });
      status.textContent = response?.error || response?.message || 'No response. Reload the extension and page.';
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }
  async function loadDownloads() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageButton = document.getElementById('download-page');
    if (!AvocadoUrls.httpUrl(tab?.url)) {
      pageButton.disabled = true;
      status.textContent = 'Open a video website first. Chrome internal pages do not allow extensions.';
      return;
    }
    pageButton.addEventListener('click', () => requestDownload(pageButton, { url: tab.url, isDirect: false, tabId: tab.id }));
    const response = await chrome.runtime.sendMessage({ type: 'GET_MEDIA', tabId: tab.id });
    for (const item of (response?.items || []).slice(-12).reverse()) {
      const parsed = AvocadoUrls.httpUrl(item.url);
      if (!parsed) continue;
      const button = document.createElement('button');
      const stream = AvocadoUrls.isStream(item.url);
      button.textContent = (stream ? 'Stream · ' : 'File · ') + parsed.hostname + parsed.pathname;
      button.title = button.textContent;
      button.addEventListener('click', () => requestDownload(button, { ...item, tabId: tab.id }));
      document.getElementById('media-list').appendChild(button);
      if (!stream) {
        const fallback = document.createElement('button');
        fallback.className = 'chrome-fallback';
        fallback.textContent = 'Save this file in Chrome instead';
        fallback.addEventListener('click', () => requestDownload(fallback, { ...item, tabId: tab.id, destination: 'chrome' }));
        document.getElementById('media-list').appendChild(fallback);
      }
    }
    if (response?.items?.length) status.textContent = 'Choose a detected file, or send the page to FDM if the file fails.';
  }
  loadDownloads().catch(error => { status.textContent = error.message; });
  loadSettings();
})();
