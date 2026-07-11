/**
 * AvocadoDL — Injected Script (Page Context)
 * 
 * Runs in the PAGE's execution context to intercept clipboard operations.
 * Detected copy events are sent back to the content script via window.postMessage.
 */

(function() {
  'use strict';
  
  // Avoid double-injection
  if (window.__avocadoDL_injected) return;
  window.__avocadoDL_injected = true;
  
  // ─── Patch clipboard.writeText ──────────────────────────────────────────────
  if (navigator.clipboard) {
    try {
      const originalWriteText = navigator.clipboard.writeText;
      if (originalWriteText) {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          value: function(text) {
            if (typeof text === 'string') {
              window.postMessage({
                __avocadoDL: true,
                type: 'CLIPBOARD_COPIED',
                text: text
              }, '*');
            }
            return originalWriteText.apply(this, arguments);
          },
          writable: true,
          configurable: true
        });
      }
    } catch (e) {
      console.log('AvocadoDL: Error patching clipboard.writeText:', e);
    }
  }

  // ─── Patch document.execCommand ─────────────────────────────────────────────
  try {
    const originalExecCommand = document.execCommand;
    document.execCommand = function(commandId, showUI, value) {
      if (commandId && commandId.toLowerCase() === 'copy') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
          const text = activeEl.value;
          if (text) {
            window.postMessage({
              __avocadoDL: true,
              type: 'CLIPBOARD_COPIED',
              text: text
            }, '*');
          }
        } else {
          const selectionText = window.getSelection()?.toString();
          if (selectionText) {
            window.postMessage({
              __avocadoDL: true,
              type: 'CLIPBOARD_COPIED',
              text: selectionText
            }, '*');
          }
        }
      }
      return originalExecCommand.apply(this, arguments);
    };
  } catch (e) {
    console.log('AvocadoDL: Error patching document.execCommand:', e);
  }
  
})();
