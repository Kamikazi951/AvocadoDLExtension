/**
 * AvocadoDL — Settings Script
 */

(function() {
  'use strict';
  
  const DEFAULT_SETTINGS = {
  showFloatingButton: true,
  showClipboardPill: true,
  buttonIdle: true,
    floatingButtonSize: 'medium',
    floatingButtonPosition: 'top-right',
    floatingButtonMode: 'full',
    floatingButtonOffset: { x: 0, y: 0 },
    theme: 'dark'
  };
  
  // DOM refs
  const floatingButtonEl = document.getElementById('floating-button');
  const floatingButtonModeEls = document.querySelectorAll('input[name="floating-button-mode"]');
  const floatingButtonSizeEl = document.getElementById('floating-button-size');
  const floatingButtonPositionEl = document.getElementById('floating-button-position');
  const clipboardPillEl = document.getElementById('clipboard-pill');
  const buttonIdleEl = document.getElementById('button-idle');
  const toastEl = document.getElementById('toast');

  function getSelectedMode() {
    for (const el of floatingButtonModeEls) {
      if (el.checked) return el.value;
    }
    return 'full';
  }
  
  let toastTimeout = null;
  
  // ─── Load Settings ──────────────────────────────────────────────────────────
  
  function loadSettings() {
    chrome.storage.sync.get('settings', (result) => {
      const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
      
      floatingButtonEl.checked = settings.showFloatingButton;
      clipboardPillEl.checked = settings.showClipboardPill !== false;
      buttonIdleEl.checked = settings.buttonIdle !== false;
      floatingButtonSizeEl.value = settings.floatingButtonSize || 'medium';
      floatingButtonPositionEl.value = settings.floatingButtonPosition || 'top-right';

      const mode = settings.floatingButtonMode || 'full';
      for (const el of floatingButtonModeEls) {
        el.checked = (el.value === mode);
      }
    });
  }
  
  // ─── Save Settings ──────────────────────────────────────────────────────────
  
  function saveSettings() {
    // Preserve fields the settings page doesn't edit (e.g. the drag offset
    // written by the content script) by merging onto the stored object.
    chrome.storage.sync.get('settings', (result) => {
      const settings = {
        ...DEFAULT_SETTINGS,
        ...(result.settings || {}),
        showFloatingButton: floatingButtonEl.checked,
        showClipboardPill: clipboardPillEl.checked,
        buttonIdle: buttonIdleEl.checked,
        floatingButtonSize: floatingButtonSizeEl.value,
        floatingButtonPosition: floatingButtonPositionEl.value,
        floatingButtonMode: getSelectedMode(),
        theme: 'dark'
      };

      chrome.storage.sync.set({ settings }, () => {
        showToast();
      });
    });
  }
  
  // ─── Toast Notification ─────────────────────────────────────────────────────
  
  function showToast(customMsg) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toastEl.textContent = customMsg || 'Settings saved ✓';
    toastEl.classList.add('show');
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2000);
  }
  
  // ─── Event Listeners ───────────────────────────────────────────────────────
  
  floatingButtonEl.addEventListener('change', saveSettings);
  clipboardPillEl.addEventListener('change', saveSettings);
  buttonIdleEl.addEventListener('change', saveSettings);
  floatingButtonSizeEl.addEventListener('change', saveSettings);
  floatingButtonPositionEl.addEventListener('change', saveSettings);
  floatingButtonModeEls.forEach((el) => el.addEventListener('change', saveSettings));

  // Reset the dragged position back to the anchored corner
  const resetPositionBtn = document.getElementById('btn-reset-position');
  if (resetPositionBtn) {
    resetPositionBtn.addEventListener('click', () => {
      chrome.storage.sync.get('settings', (result) => {
        const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
        settings.floatingButtonOffset = { x: 0, y: 0 };
        chrome.storage.sync.set({ settings }, () => {
          showToast('Button position reset ✓');
        });
      });
    });
  }

  // Reset settings button
  document.getElementById('btn-reset-settings').addEventListener('click', () => {
    chrome.storage.sync.set({ settings: DEFAULT_SETTINGS }, () => {
      loadSettings();
      showToast('Settings reset to defaults ✓');
    });
  });
  
  // ─── Init ───────────────────────────────────────────────────────────────────
  
  loadSettings();
  
})();
