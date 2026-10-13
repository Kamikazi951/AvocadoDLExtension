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

  // On X, reuse media metadata the page already loads. Parsing a cloned
  // response runs in the background and never delays the page's fetch promise.
  if (['x.com', 'twitter.com'].some(host => location.hostname === host || location.hostname.endsWith('.' + host))) {
    const cache = new Map();
    function announce(items) {
      if (items.length) window.postMessage({ __avocadoDL: true, type: 'TWITTER_MEDIA', items }, '*');
    }
    function ingest(json) {
      const items = AvocadoTwitter.extract(json);
      for (const item of items) {
        cache.delete(item.key);
        cache.set(item.key, item);
        if (cache.size > 200) cache.delete(cache.keys().next().value);
      }
      announce(items);
    }
    function isMediaApi(value) {
      try {
        const url = new URL(value, location.href);
        return url.origin === location.origin && /\/(i\/api|graphql)\//.test(url.pathname);
      } catch { return false; }
    }
    const pageFetch = window.fetch;
    window.fetch = function(...args) {
      const request = pageFetch.apply(this, args);
      const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
      if (isMediaApi(url)) request.then(response => {
        if (response.ok && Number(response.headers.get('content-length') || 0) < 8_000_000) {
          response.clone().json().then(ingest).catch(() => {});
        }
      }).catch(() => {});
      return request;
    };
    const xhrUrls = new WeakMap();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      xhrUrls.set(this, url);
      return open.call(this, method, url, ...args);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      if (isMediaApi(xhrUrls.get(this))) this.addEventListener('load', function() {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === 'json') ingest(this.response);
          else if ((!this.responseType || this.responseType === 'text') && this.responseText.length < 8_000_000) ingest(JSON.parse(this.responseText));
        } catch {}
      }, { once: true });
      return send.apply(this, args);
    };
    window.addEventListener('message', event => {
      if (event.source === window && event.data?.__avocadoDL && event.data.type === 'TWITTER_MEDIA_REQUEST') announce([...cache.values()]);
    });
  }
  
  // ─── Patch clipboard.writeText ──────────────────────────────────────────────
  if (navigator.clipboard) {
    try {
      const originalWriteText = navigator.clipboard.writeText;
      if (originalWriteText) {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          value: function(text) {
            const result = originalWriteText.apply(this, arguments);
            result.then(() => {
              if (typeof text === 'string' && text.length <= 16384) {
                window.postMessage({ __avocadoDL: true, type: 'CLIPBOARD_COPIED', text }, '*');
              }
            }, () => {});
            return result;
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

  // Observe completed media requests without replacing fetch/XHR or reading
  // response bodies. This also finds HLS/DASH manifests used by blob players.
  try {
    const seen = new Set();
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!/^https?:\/\//i.test(entry.name) ||
            !/\.(mp4|webm|m4a|mp3|m3u8|mpd)([?#]|$)/i.test(entry.name) || seen.has(entry.name)) continue;
        if (seen.size >= 100) seen.delete(seen.values().next().value);
        seen.add(entry.name);
        window.postMessage({ __avocadoDL: true, type: 'MEDIA_INTERCEPTED', url: entry.name }, '*');
      }
    }).observe({ type: 'resource', buffered: true });
  } catch { /* Older or restricted frames can omit resource timing. */ }
  
})();
