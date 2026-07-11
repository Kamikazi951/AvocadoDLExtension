(function() {
  'use strict';

  const DEFAULT_SETTINGS = {
    showFloatingButton: true,
    showClipboardPill: true,
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

  loadSettings();
})();