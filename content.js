/**
 * AvocadoDL — Content Script
 *
 * Runs on every page. Responsibilities:
 * 1. Receives observations from the declarative page-context interceptor
 * 2. DOM Scanner — MutationObserver for <video>, <audio>, <source> elements
 * 3. Floating download button — document-level mouse tracking (works on social media)
 * 4. Message bridge — relays from injected.js → background service worker
 * 5. Thumbnail & title extraction for the popup
 */

(function() {
  'use strict';

  if (window.__avocadoDLContentScriptLoaded) return;
  window.__avocadoDLContentScriptLoaded = true;

  // Safe helper to check if extension context is alive (prevents "Extension context invalidated" errors)
  function isExtensionContextValid() {
    return typeof chrome !== 'undefined' && !!chrome?.runtime?.id && typeof chrome?.runtime?.sendMessage === 'function';
  }

  function safeSendMessage(message, callback) {
    if (!isExtensionContextValid()) {
      callback?.({ error: 'Extension updated. Refresh this page and try again.' });
      return;
    }
    try {
      const p = chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime?.lastError) {
          response = { error: chrome.runtime.lastError.message };
        }
        if (typeof callback === 'function') {
          callback(response);
        }
      });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch (e) {
      callback?.({ error: 'Extension updated. Refresh this page and try again.' });
    }
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  const detectedUrls = new Set();
  const twitterMedia = new Map();
  let floatingBtn = null;
  let currentVideoTarget = null;
  let currentHoveredVideo = null;
  let showFloatingButton = true;
  let showClipboardPillSetting = true;
  let floatingButtonSize = 'medium';
  let floatingButtonPosition = 'top-right';
  let floatingButtonMode = 'full';
  let floatingButtonOffset = { x: 0, y: 0 };
  let hideTimeout = null;
  let mouseMoveThrottle = null;
  let isDraggingButton = false;
  let isDragArmed = false;
  let suppressButtonClick = false;
  let dismissedVideoElements = new WeakMap();
  let buttonIdleEnabled = true;
  let mouseIdleTimer = null;
  let minVideoDuration = 0;
  let idleOpacity = 0.25;
  let dismissedKeys = new Set();



  function isSpecificVideoUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname;

      // YouTube watch or shorts
      if (AvocadoUrls.hostMatches(host, 'youtube.com') && (path.startsWith('/watch') || path.startsWith('/shorts/'))) return true;
      if (AvocadoUrls.hostMatches(host, 'youtu.be') && path.length > 1) return true;

      // Twitter / X status
      if ((AvocadoUrls.hostMatches(host, 'twitter.com') || AvocadoUrls.hostMatches(host, 'x.com')) && /\/status\/\d+/i.test(path)) return true;

      // TikTok video
      if (AvocadoUrls.hostMatches(host, 'tiktok.com') && /(\/video\/|\/photo\/|\/v\/)\d+/i.test(path)) return true;

      // Instagram post/reel
      if (AvocadoUrls.hostMatches(host, 'instagram.com') && /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i.test(path)) return true;

      // Reddit comments
      if (AvocadoUrls.hostMatches(host, 'reddit.com') && /\/comments\/[a-zA-Z0-9]+/i.test(path)) return true;

      // Facebook post / video / reel
      if (AvocadoUrls.hostMatches(host, 'facebook.com') && /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i.test(path)) return true;

      // Threads / Bluesky / Pinterest / Twitch
      if ((AvocadoUrls.hostMatches(host, 'threads.net') || AvocadoUrls.hostMatches(host, 'threads.com')) && /\/post\/[a-zA-Z0-9_-]+/i.test(path)) return true;
      if (AvocadoUrls.hostMatches(host, 'bsky.app') && /\/post\/[a-zA-Z0-9_-]+/i.test(path)) return true;
      if (AvocadoUrls.hostMatches(host, 'pinterest.com') && /\/pin\/\d+/i.test(path)) return true;
      if (AvocadoUrls.hostMatches(host, 'twitch.tv') && (path.includes('/clip/') || path.includes('/videos/'))) return true;

      // Direct media files
      if (MEDIA_EXTENSIONS && (MEDIA_EXTENSIONS.test(path) || MEDIA_EXTENSIONS.test(url))) return true;

      return false;
    } catch (e) {
      return false;
    }
  }

  function isVideoDismissed(videoElement, videoUrl) {
    return dismissedVideoElements.get(videoElement) === videoUrl || dismissedKeys.has(videoUrl);
  }

  function updateAttachedState() {
    if (!floatingBtn) return;
    const bar = floatingBtn.bar;
    if (!bar) return;
    const isAttached = floatingButtonOffset.x === 0 && floatingButtonOffset.y === 0;
    bar.classList.toggle('attached', isAttached);
  }

  function updateFloatingButtonStyles() {
    if (!floatingBtn) return;
    const bar = floatingBtn.bar;
    if (!bar) return;
    bar.classList.remove(
      'size-small', 'size-medium', 'size-large',
      'pos-top-left', 'pos-top-right', 'pos-bottom-left', 'pos-bottom-right',
      'mode-full', 'mode-mini'
    );
    bar.classList.add(`size-${floatingButtonSize}`);
    bar.classList.add(`pos-${floatingButtonPosition}`);
    bar.classList.add(`mode-${floatingButtonMode}`);
    updateAttachedState();
    applyDragOffset();
  }

  function applyDragOffset() {
    if (!floatingBtn) return;
    const bar = floatingBtn.bar;
    if (!bar) return;
    bar.style.transform = `translate(${floatingButtonOffset.x}px, ${floatingButtonOffset.y}px)`;
    if (floatingBtn.host.isConnected) {
      const rect = bar.getBoundingClientRect();
      const dx = rect.left < 4 ? 4 - rect.left : Math.min(0, innerWidth - rect.right - 4);
      const dy = rect.top < 4 ? 4 - rect.top : Math.min(0, innerHeight - rect.bottom - 4);
      bar.style.transform = `translate(${floatingButtonOffset.x + dx}px, ${floatingButtonOffset.y + dy}px)`;
    }
    updateAttachedState();
  }

  function applyLoadedSettings(settings) {
    if (!settings) return;
    showFloatingButton = settings.showFloatingButton !== false;
    showClipboardPillSetting = settings.showClipboardPill !== false;
    buttonIdleEnabled = settings.buttonIdle !== false;
    minVideoDuration = settings.minVideoDuration || 0;
    idleOpacity = (settings.idleOpacity !== undefined) ? settings.idleOpacity : 0.25;
    floatingButtonSize = settings.floatingButtonSize || 'medium';
    floatingButtonPosition = settings.floatingButtonPosition || 'top-right';
    floatingButtonMode = settings.floatingButtonMode || 'full';
    updateFloatingButtonStyles();
    if (floatingBtn) {
      floatingBtn.bar.style.setProperty('--idle-opacity', idleOpacity);
    }
  }

  // Load settings on startup
  chrome.storage.sync.get('settings', (result) => {
    applyLoadedSettings(result.settings);
  });

  // ─── 2. Clipboard Interception Download Pill UI ──────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .avocado-clipboard-pill {
      position: fixed;
      bottom: -100px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(10, 14, 20, 0.95);
      border: 1px solid rgba(124, 179, 66, 0.4);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 16px rgba(124, 179, 66, 0.2);
      border-radius: 50px;
      padding: 10px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #e6edf3;
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      pointer-events: auto;
      backdrop-filter: blur(12px);
    }
    .avocado-clipboard-pill.show {
      bottom: 40px;
    }
    .avocado-clipboard-logo {
      width: 24px;
      height: 24px;
      filter: drop-shadow(0 2px 6px rgba(124, 179, 66, 0.3));
    }
    .avocado-clipboard-text {
      font-size: 13px;
      font-weight: 500;
      letter-spacing: -0.1px;
    }
    .avocado-clipboard-actions {
      display: flex;
      gap: 8px;
    }
    .avocado-clipboard-btn {
      border: none;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 30px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .avocado-clipboard-btn.download {
      background: linear-gradient(135deg, #8bc34a 0%, #7cb342 50%, #558b2f 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(124, 179, 66, 0.35);
    }
    .avocado-clipboard-btn.download:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 12px rgba(124, 179, 66, 0.5);
    }
    .avocado-clipboard-btn.download:active {
      transform: scale(0.95);
    }
    .avocado-clipboard-btn.dismiss {
      background: rgba(255, 255, 255, 0.08);
      color: #7d8590;
    }
    .avocado-clipboard-btn.dismiss:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #e6edf3;
    }
  `;
  document.head ? document.head.appendChild(style) : document.documentElement.appendChild(style);

  let activePill = null;
  let pillTimeout = null;

  function displayClipboardPill(url) {
    if (activePill) {
      activePill.remove();
      activePill = null;
    }
    if (pillTimeout) {
      clearTimeout(pillTimeout);
    }

    const pill = document.createElement('div');
    pill.className = 'avocado-clipboard-pill';

    let platform = 'video';
    if (url.includes('instagram.com')) platform = 'Instagram';
    else if (url.includes('twitter.com') || url.includes('x.com')) platform = 'Twitter';
    else if (url.includes('tiktok.com')) platform = 'TikTok';
    else if (url.includes('reddit.com')) platform = 'Reddit';
    else if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'YouTube';
    else if (url.includes('facebook.com')) platform = 'Facebook';

    pill.innerHTML = `
      <svg class="avocado-clipboard-logo" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px;">
        <circle cx="16" cy="16" r="14" fill="#7cb342" opacity="0.2"/>
        <path d="M16 6C11 6 7 11 7 17c0 5 3 9 9 9s9-4 9-9c0-6-4-11-9-11zm0 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" fill="#7cb342"/>
        <circle cx="16" cy="16" r="2.5" fill="#aed581"/>
      </svg>
      <span class="avocado-clipboard-text">Download copied ${platform} video?</span>
      <div class="avocado-clipboard-actions">
        <button class="avocado-clipboard-btn dismiss">Dismiss</button>
        <button class="avocado-clipboard-btn download">Download</button>
      </div>
    `;

    document.body.appendChild(pill);
    activePill = pill;

    setTimeout(() => {
      pill.classList.add('show');
    }, 50);

    pill.querySelector('.download').addEventListener('click', () => {
      const button = pill.querySelector('.download');
      button.disabled = true;
      button.textContent = 'Requesting…';
      safeSendMessage({ type: 'DOWNLOAD_AS', url, isDirect: false, pageUrl: location.href }, response => {
        button.disabled = false;
        button.textContent = response?.error ? 'Try again' : 'Check FDM';
        pill.querySelector('.avocado-clipboard-text').textContent = response?.error || response?.message || 'No response. Please refresh this page.';
      });
    });

    pill.querySelector('.dismiss').addEventListener('click', dismissPill);

    pillTimeout = setTimeout(() => {
      dismissPill();
    }, 8000);
  }

  function dismissPill() {
    if (activePill) {
      activePill.classList.remove('show');
      const tempPill = activePill;
      activePill = null;
      setTimeout(() => {
        tempPill.remove();
      }, 400);
    }
    if (pillTimeout) {
      clearTimeout(pillTimeout);
    }
  }

  function checkAndTriggerClipboardPill(text) {
    if (!showClipboardPillSetting) return;
    if (typeof text !== 'string' || text.length > 16384) return;
    const cleanText = text.trim();
    const parsed = AvocadoUrls.httpUrl(cleanText);
    if (parsed && AvocadoUrls.isSocial(parsed.href)) displayClipboardPill(parsed.href);
  }

  // ─── 3. Message Bridge (injected.js → background & clipboard catch) ──────────

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || !event.data.__avocadoDL) return;

    if (event.data.type === 'MEDIA_INTERCEPTED') {
      reportToBackground(event.data.url, event.data.mediaType, 'intercept');
    }
    if (event.data.type === 'CLIPBOARD_COPIED') {
      checkAndTriggerClipboardPill(event.data.text);
    }
    if (event.data.type === 'TWITTER_MEDIA' && Array.isArray(event.data.items) &&
        (AvocadoUrls.hostMatches(location.hostname, 'x.com') || AvocadoUrls.hostMatches(location.hostname, 'twitter.com'))) {
      for (const item of event.data.items.slice(0, 200)) {
        const key = AvocadoTwitter.posterKey(item?.poster);
        const variant = AvocadoTwitter.bestVariant([item]);
        if (!key || !variant) continue;
        twitterMedia.delete(key);
        twitterMedia.set(key, { ...variant, timestamp: Date.now() });
        if (twitterMedia.size > 200) twitterMedia.delete(twitterMedia.keys().next().value);
      }
    }
  });
  // Replay API data captured before this document_end content script loaded.
  window.postMessage({ __avocadoDL: true, type: 'TWITTER_MEDIA_REQUEST' }, '*');

  // Also catch manual browser copies (e.g. highlighting text and copying)
  document.addEventListener('copy', () => {
    setTimeout(() => {
      const selectedText = window.getSelection()?.toString()?.trim();
      if (selectedText) {
        checkAndTriggerClipboardPill(selectedText);
      }
    }, 100);
  });

  function reportToBackground(url, mediaType, source) {
    if (!AvocadoUrls.httpUrl(url) || detectedUrls.has(url)) return;
    if (AvocadoUrls.httpUrl(url).searchParams.has('fdmguid')) return;
    if (url.startsWith('blob:') || url.startsWith('data:')) return;

    if (detectedUrls.size >= 100) detectedUrls.delete(detectedUrls.values().next().value);
    detectedUrls.add(url);

    // Extract thumbnail and title info for the popup
    const pageTitle = document.title || '';
    const thumbnail = getPageThumbnail();

    safeSendMessage({
      type: 'MEDIA_FOUND',
      url: url,
      mediaType: mediaType || '',
      source: source || 'dom',
      isDirect: true,
      size: -1,
      pageTitle: pageTitle,
      thumbnail: thumbnail
    });
  }

  /**
   * Tries to extract a thumbnail URL from the page.
   * Checks: og:image meta, twitter:image meta, video poster, first large image near video.
   */
  function getPageThumbnail() {
    // Try og:image (works on YouTube, Twitter, Facebook, etc.)
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage?.content) return ogImage.content;

    // Try twitter:image
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (twitterImage?.content) return twitterImage.content;

    // Try video poster attribute
    const video = document.querySelector('video[poster]');
    if (video?.poster) return video.poster;

    // Try link[rel="image_src"]
    const imageSrc = document.querySelector('link[rel="image_src"]');
    if (imageSrc?.href) return imageSrc.href;

    return '';
  }

  // ─── 3. DOM Scanner ─────────────────────────────────────────────────────────

  const MEDIA_EXTENSIONS = /\.(mp4|webm|mkv|avi|mov|flv|wmv|m4v|3gp|ogv|mp3|m4a|aac|ogg|opus|flac|wav|wma|m3u8|mpd)(\?|#|$)/i;

  function extractMediaSrc(element) {
    const selected = element.currentSrc || element.getAttribute('src');
    // An active blob overrides child sources; those can be stale fallbacks.
    if (selected) return AvocadoUrls.httpUrl(selected, document.baseURI)?.href || null;
    const candidates = Array.from(element.querySelectorAll('source[src]'), source => source.src);
    for (const src of candidates) {
      const parsed = src && AvocadoUrls.httpUrl(src, document.baseURI);
      if (parsed) return parsed.href;
    }
    return null;
  }

  // Cache players, including open shadow roots, instead of querying the entire
  // document on every pointer move. New roots are also discovered on hover.
  const mediaElements = new Set();
  const watchedRoots = new WeakSet();
  function scanMedia(root) {
    if (root.nodeType === 1 && root.matches('video,audio')) mediaElements.add(root);
    if (root.nodeType === 1 && root.shadowRoot) watchRoot(root.shadowRoot);
    for (const node of root.querySelectorAll?.('*') || []) {
      if (node.matches('video,audio')) mediaElements.add(node);
      if (node.shadowRoot) watchRoot(node.shadowRoot);
    }
    for (const media of mediaElements) {
      if (!media.isConnected) { mediaElements.delete(media); continue; }
      const src = extractMediaSrc(media);
      if (src) reportToBackground(src, media.tagName.toLowerCase(), 'dom');
    }
  }
  function watchRoot(root) {
    if (watchedRoots.has(root)) return;
    watchedRoots.add(root);
    scanMedia(root);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const media = record.target.closest('video,audio');
          const src = media && extractMediaSrc(media);
          if (src) reportToBackground(src, media.tagName.toLowerCase(), 'dom');
        } else {
          for (const node of record.addedNodes) if (node.nodeType === 1) scanMedia(node);
        }
      }
      for (const media of mediaElements) if (!media.isConnected) mediaElements.delete(media);
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }
  function getMediaElements() { return [...mediaElements].filter(media => media.isConnected); }
  watchRoot(document);
  for (const entry of performance.getEntriesByType('resource')) {
    if (AvocadoUrls.isMedia(entry.name)) reportToBackground(entry.name, '', 'network');
  }
  document.addEventListener('loadedmetadata', event => {
    if (event.target.matches?.('video,audio')) scanMedia(event.target);
  }, true);

  function findSocialPostUrl(videoElement) {
    const hostname = window.location.hostname;
    const href = window.location.href;

    try {
      // TikTok feeds display videos inside containers with IDs like "xgwrapper-0-VIDEOID"
      if (AvocadoUrls.hostMatches(hostname, 'tiktok.com')) {
        const wrapper = videoElement.closest('[id*="xgwrapper-"]');
        let videoId = null;
        if (wrapper) {
          const m = wrapper.id.match(/xgwrapper-\d+-(\d{15,22})/);
          if (m) videoId = m[1];
        }
        if (!videoId) {
          let node = videoElement.parentElement;
          for (let i = 0; i < 10; i++) {
            if (!node) break;
            const w = node.querySelector('[id*="xgwrapper-"]');
            if (w) {
              const m = w.id.match(/xgwrapper-\d+-(\d{15,22})/);
              if (m) {
                videoId = m[1];
                break;
              }
            }
            node = node.parentElement;
          }
        }
        if (videoId) {
          let author = 'video';
          const card = videoElement.closest('[data-e2e="recommend-list-item"], [data-e2e="user-post-item-list"], div[class*="ItemContainer"], div[class*="RecommendItem"], div[class*="DivItemContainer"]');
          const authLink = (card ? card.querySelector('a[href*="/@"]') : null) ||
                           document.querySelector('[data-e2e="video-author-uniqueid"]')?.closest('a') ||
                           document.querySelector('a[data-e2e="video-author-avatar"]') ||
                           document.querySelector('[class*="CreatorInfo"] a[href*="/@"]');
          if (authLink && authLink.href) {
            const am = authLink.href.match(/@([^/?#]+)/);
            if (am) author = am[1];
          }
          const postUrl = `https://www.tiktok.com/@${author}/video/${videoId}`;
          console.log('AvocadoDL: Resolved TikTok URL from xgwrapper:', postUrl);
          return postUrl;
        }
      }

      // YouTube card & feed items
      if (AvocadoUrls.hostMatches(hostname, 'youtube.com')) {
        const card = videoElement.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, ytd-compact-video-renderer, ytd-shorts, ytd-notification-renderer');
        if (card) {
          const link = card.querySelector('a#thumbnail, a[href*="/watch?v="], a[href*="/shorts/"]');
          if (link && link.href) {
            return link.href;
          }
        }
      }

      // 2. Identify the site-specific card container and link patterns
      let cardSelector = null;
      let pattern = null;

      if (AvocadoUrls.hostMatches(hostname, 'instagram.com')) {
        cardSelector = 'article';
        pattern = /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i;
      } else if (AvocadoUrls.hostMatches(hostname, 'twitter.com') || AvocadoUrls.hostMatches(hostname, 'x.com')) {
        cardSelector = 'article, [data-testid="tweet"]';
        pattern = /\/status\/\d+/i;
      } else if (AvocadoUrls.hostMatches(hostname, 'tiktok.com')) {
        cardSelector = '[data-e2e="recommend-list-item"], [data-e2e="user-post-item-list"], div[class*="ItemContainer"], div[class*="RecommendItem"], div[class*="DivItemContainer"]';
        pattern = /(\/video\/|\/photo\/|\/v\/)\d+/i;
      } else if (AvocadoUrls.hostMatches(hostname, 'facebook.com')) {
        cardSelector = '[role="article"], div[data-testid="fbfeed_story"], div[class*="userContentWrapper"]';
        pattern = /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i;
      } else if (AvocadoUrls.hostMatches(hostname, 'reddit.com')) {
        cardSelector = 'shreddit-post, [data-testid="post-container"], div.Post, [role="article"]';
        pattern = /\/comments\/[a-zA-Z0-9]+/i;
      } else if ((AvocadoUrls.hostMatches(hostname, 'threads.net') || AvocadoUrls.hostMatches(hostname, 'threads.com'))) {
        cardSelector = 'div[data-pressable-container="true"], article, div[role="article"]';
        pattern = /\/post\/[a-zA-Z0-9_-]+/i;
      } else if (AvocadoUrls.hostMatches(hostname, 'bsky.app')) {
        cardSelector = 'div[data-testid*="post-"], div[data-testid="feedItem"]';
        pattern = /\/profile\/[^/]+\/post\/[a-zA-Z0-9]+/i;
      } else if (AvocadoUrls.hostMatches(hostname, 'pinterest.com')) {
        cardSelector = 'div[data-test-id="pin"], div[data-test-id="pinWrapper"]';
        pattern = /\/pin\/\d+/i;
      }

      if (!pattern) return null;

      // Method 1: Find the closest card container using site selectors
      if (cardSelector) {
        const card = videoElement.closest(cardSelector);
        if (card) {
          const links = card.querySelectorAll('a');
          for (const link of links) {
            if (link.href && pattern.test(link.href)) {
              if (!link.href.includes('/tagged/') && !link.href.includes('/liked/') && !link.href.includes('/sharer/')) {
                return link.href;
              }
            }
          }
        }
      }

      // Only use the page permalink outside cards; a feed is not a video URL.
      if (!videoElement.closest('article, [role="article"]') && isSpecificVideoUrl(href)) return href;
    } catch (e) {
      console.log('AvocadoDL: Error resolving social post URL:', e);
    }

    return null;
  }

  function getDownloadUrl(videoElement) {
    const hostname = window.location.hostname;
    const href = window.location.href;

    if (AvocadoUrls.hostMatches(hostname, 'x.com') || AvocadoUrls.hostMatches(hostname, 'twitter.com')) {
      const key = AvocadoTwitter.posterKey(videoElement.poster);
      const media = key && twitterMedia.get(key);
      if (media && Date.now() - media.timestamp < 20 * 60 * 1000) {
        reportToBackground(media.url, 'video/mp4', 'twitter');
        return { url: media.url, isDirect: true };
      }
      const direct = extractMediaSrc(videoElement);
      if (direct && AvocadoUrls.httpUrl(direct)?.hostname === 'video.twimg.com' && !AvocadoUrls.isStream(direct)) {
        return { url: direct, isDirect: true };
      }
    }

    if (AvocadoUrls.hostMatches(hostname, 'instagram.com') ||
        AvocadoUrls.hostMatches(hostname, 'twitter.com') ||
        AvocadoUrls.hostMatches(hostname, 'x.com') ||
        AvocadoUrls.hostMatches(hostname, 'tiktok.com') ||
        AvocadoUrls.hostMatches(hostname, 'reddit.com') ||
        AvocadoUrls.hostMatches(hostname, 'facebook.com') ||
        (AvocadoUrls.hostMatches(hostname, 'threads.net') || AvocadoUrls.hostMatches(hostname, 'threads.com')) ||
        AvocadoUrls.hostMatches(hostname, 'bsky.app') ||
        AvocadoUrls.hostMatches(hostname, 'pinterest.com')) {
      const postUrl = findSocialPostUrl(videoElement);
      if (postUrl) {
        return { url: postUrl, isDirect: false };
      }

      // Fallback: only allow the current page URL if it's a valid post page
      const isPostPage = (AvocadoUrls.hostMatches(hostname, 'instagram.com') && /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i.test(href)) ||
                         ((AvocadoUrls.hostMatches(hostname, 'twitter.com') || AvocadoUrls.hostMatches(hostname, 'x.com')) && /\/status\/\d+/i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'tiktok.com') && /(\/video\/|\/photo\/|\/v\/)\d+/i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'reddit.com') && /\/comments\//i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'facebook.com') && /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i.test(href)) ||
                         ((AvocadoUrls.hostMatches(hostname, 'threads.net') || AvocadoUrls.hostMatches(hostname, 'threads.com')) && /\/post\/[a-zA-Z0-9_-]+/i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'bsky.app') && /\/profile\/[^/]+\/post\/[a-zA-Z0-9]+/i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'pinterest.com') && /\/pin\/\d+/i.test(href));

      if (isPostPage && !videoElement.closest('article, [role="article"]')) return { url: href, isDirect: false };
      const directSrc = extractMediaSrc(videoElement);
      if (directSrc) return { url: directSrc, isDirect: true };

      // Do NOT fall back to feed homepage URLs (e.g. tiktok.com/ or x.com/home)
      return null;
    }

    if (AvocadoUrls.hostMatches(hostname, 'youtube.com') || AvocadoUrls.hostMatches(hostname, 'youtu.be')) {
      const ytUrl = findSocialPostUrl(videoElement);
      if (ytUrl) return { url: ytUrl, isDirect: false };
      if (href.includes('/watch') || href.includes('/shorts/')) return { url: href, isDirect: false };
    }

    const directSrc = extractMediaSrc(videoElement);
    if (directSrc) return { url: directSrc, isDirect: true };

    const pageUrl = AvocadoUrls.httpUrl(href) ? href : document.referrer;
    return AvocadoUrls.httpUrl(pageUrl) ? { url: pageUrl, isDirect: false } : null;
  }

  /**
   * Checks if a video element is big enough to be a real player (not a thumbnail).
   */
  function isRealVideoPlayer(videoElement) {
    const rect = videoElement.getBoundingClientRect();
    // Must be at least 50x50 pixels (covers small players, embeds, mobile frames)
    return rect.width >= 50 && rect.height >= (videoElement.tagName === 'AUDIO' ? 20 : 50);
  }

  // Handle SPA navigation (YouTube, Twitter, etc.)
  let lastUrl = window.location.href;

  function onNavigate() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      currentHoveredVideo = null;
      detectedUrls.clear();
      dismissedKeys.clear();
      dismissedVideoElements = new WeakMap();
      scanMedia(document);
      floatingButtonOffset = { x: 0, y: 0 };
      hideOverlayButton();
    }
  }

  // YouTube fires this custom event on navigation
  window.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);

  // The page's History API lives in a different execution world.
  window.addEventListener('hashchange', onNavigate);
  setInterval(() => { if (!document.hidden) onNavigate(); }, 1000);

  // ─── 4. Floating Download Button ────────────────────────────────────────────
  //
  // CRITICAL: We use document-level mousemove tracking instead of per-element
  // mouseenter. This is because social media sites (Twitter, Facebook, TikTok,
  // Instagram) place transparent overlay divs on top of <video> elements for
  // their own click handlers, so mouseenter never fires on the <video> itself.
  //
  // Our approach: track mouse coords → check if within any <video>'s bounding
  // rect → show/hide button. This bypasses all overlay divs.

  function createFloatingButton() {
    if (floatingBtn) return floatingBtn;

    // Create in a shadow DOM to isolate from page styles
    const host = document.createElement('div');
    host.id = 'avocadodl-host';

    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .avocado-dl-bar {
        pointer-events: all;
        position: absolute;
        display: inline-flex;
        align-items: stretch;
        border-radius: 16px;
        overflow: hidden;
        background: rgba(12, 16, 20, 0.82);
        border: 1px solid rgba(124, 179, 66, 0.4);
        box-shadow: 0 0 0 1px rgba(124, 179, 66, 0.3);
        -webkit-backdrop-filter: blur(16px);
        backdrop-filter: blur(16px);
        opacity: 0;
        animation: avocadoBarIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        will-change: transform;
        user-select: none;
        -webkit-user-select: none;
        transition: opacity 0.6s ease;
      }
      .avocado-dl-bar.idle {
        opacity: var(--idle-opacity, 0.25) !important;
        animation: none !important;
      }
      .avocado-dl-bar.dragging {
        animation: none !important;
        opacity: 1 !important;
        cursor: grabbing;
        transition: none !important;
        box-shadow: 0 0 0 1px rgba(124, 179, 66, 0.5);
      }

      .avocado-dl-bar.pos-top-right    { right: 0 !important; left: auto !important; bottom: auto !important; }
      .avocado-dl-bar.pos-top-right.size-small   { top: -26px !important; }
      .avocado-dl-bar.pos-top-right.size-medium  { top: -32px !important; }
      .avocado-dl-bar.pos-top-right.size-large   { top: -38px !important; }
      .avocado-dl-bar.pos-top-right.mode-mini.size-small  { top: -28px !important; }
      .avocado-dl-bar.pos-top-right.mode-mini.size-medium { top: -34px !important; }
      .avocado-dl-bar.pos-top-right.mode-mini.size-large  { top: -44px !important; }
      .avocado-dl-bar.pos-top-left     { left: 0 !important; right: auto !important; bottom: auto !important; }
      .avocado-dl-bar.pos-top-left.size-small   { top: -26px !important; }
      .avocado-dl-bar.pos-top-left.size-medium  { top: -32px !important; }
      .avocado-dl-bar.pos-top-left.size-large   { top: -38px !important; }
      .avocado-dl-bar.pos-top-left.mode-mini.size-small  { top: -28px !important; }
      .avocado-dl-bar.pos-top-left.mode-mini.size-medium { top: -34px !important; }
      .avocado-dl-bar.pos-top-left.mode-mini.size-large  { top: -44px !important; }
      .avocado-dl-bar.pos-bottom-right { right: 0 !important; left: auto !important; top: auto !important; }
      .avocado-dl-bar.pos-bottom-right.size-small   { bottom: -26px !important; }
      .avocado-dl-bar.pos-bottom-right.size-medium  { bottom: -32px !important; }
      .avocado-dl-bar.pos-bottom-right.size-large   { bottom: -38px !important; }
      .avocado-dl-bar.pos-bottom-right.mode-mini.size-small  { bottom: -28px !important; }
      .avocado-dl-bar.pos-bottom-right.mode-mini.size-medium { bottom: -34px !important; }
      .avocado-dl-bar.pos-bottom-right.mode-mini.size-large  { bottom: -44px !important; }
      .avocado-dl-bar.pos-bottom-left  { left: 0 !important; right: auto !important; top: auto !important; }
      .avocado-dl-bar.pos-bottom-left.size-small   { bottom: -26px !important; }
      .avocado-dl-bar.pos-bottom-left.size-medium  { bottom: -32px !important; }
      .avocado-dl-bar.pos-bottom-left.size-large   { bottom: -38px !important; }
      .avocado-dl-bar.pos-bottom-left.mode-mini.size-small  { bottom: -28px !important; }
      .avocado-dl-bar.pos-bottom-left.mode-mini.size-medium { bottom: -34px !important; }
      .avocado-dl-bar.pos-bottom-left.mode-mini.size-large  { bottom: -44px !important; }

      .avocado-dl-bar { cursor: grab; }
      .avocado-dl-bar:active { cursor: grabbing; }
      .avocado-dl-bar.dragging { cursor: grabbing !important; }

      .avocado-dl-bar.attached {
        border-radius: 8px 8px 0 0 !important;
      }
      .avocado-dl-bar.attached.mode-mini {
        border-radius: 8px 8px 0 0 !important;
      }
      .avocado-dl-bar.attached.pos-bottom-right,
      .avocado-dl-bar.attached.pos-bottom-left {
        border-radius: 0 0 8px 8px !important;
      }
      .avocado-dl-bar.attached.mode-mini.pos-bottom-right,
      .avocado-dl-bar.attached.mode-mini.pos-bottom-left {
        border-radius: 0 0 8px 8px !important;
      }

      .avocado-dl-btn {
        pointer-events: all;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 20px 10px 16px;
        border: none;
        cursor: pointer;
        background: linear-gradient(135deg, #8bc34a 0%, #7cb342 45%, #689f38 80%, #558b2f 100%);
        color: #ffffff;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.15px;
        white-space: nowrap;
        transition: filter 0.15s ease, box-shadow 0.15s ease;
        outline: none;
        text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        -webkit-font-smoothing: antialiased;
      }
      .avocado-dl-btn:hover { filter: brightness(1.1) saturate(1.1); box-shadow: inset 0 0 30px rgba(255,255,255,0.05); }
      .avocado-dl-btn:active { filter: brightness(0.92); }
      .avocado-dl-btn svg {
        width: 16px;
        height: 16px;
        fill: #ffffff;
        flex-shrink: 0;
        filter: drop-shadow(0 1px 3px rgba(0,0,0,0.3));
      }
      .avocado-dl-btn .btn-label { line-height: 1; }

      .avocado-dl-bar.size-small  .avocado-dl-btn { padding: 5px 10px 5px 8px; font-size: 10px; gap: 5px; }
      .avocado-dl-bar.size-small  .avocado-dl-btn svg { width: 11px; height: 11px; }
      .avocado-dl-bar.size-small  .avocado-dl-close { width: 26px !important; }
      .avocado-dl-bar.size-medium .avocado-dl-btn { padding: 7px 14px 7px 11px; font-size: 11.5px; gap: 7px; }
      .avocado-dl-bar.size-medium .avocado-dl-btn svg { width: 13px; height: 13px; }
      .avocado-dl-bar.size-medium .avocado-dl-close { width: 32px !important; }

      .avocado-dl-bar.mode-mini {
        border-radius: 50%;
        box-shadow: 0 0 0 1px rgba(124, 179, 66, 0.3);
        background: linear-gradient(135deg, #8bc34a 0%, #7cb342 45%, #689f38 80%, #558b2f 100%);
        border: none;
        padding: 0;
      }
      .avocado-dl-bar.mode-mini:hover {
        filter: brightness(1.08);
        box-shadow: 0 0 0 1px rgba(124, 179, 66, 0.5);
      }
      .avocado-dl-bar.mode-mini .avocado-dl-btn {
        padding: 12px;
        gap: 0;
        border-radius: 50%;
        background: transparent;
        text-shadow: none;
      }
      .avocado-dl-bar.mode-mini .btn-label,
      .avocado-dl-bar.mode-mini .avocado-dl-divider,
      .avocado-dl-bar.mode-mini .avocado-dl-close { display: none !important; }
      .avocado-dl-bar.mode-mini .avocado-dl-btn svg { width: 20px; height: 20px; }
      .avocado-dl-bar.mode-mini.size-small  .avocado-dl-btn { padding: 7px; }
      .avocado-dl-bar.mode-mini.size-small  .avocado-dl-btn svg { width: 13px; height: 13px; }
      .avocado-dl-bar.mode-mini.size-medium .avocado-dl-btn { padding: 9px; }
      .avocado-dl-bar.mode-mini.size-medium .avocado-dl-btn svg { width: 16px; height: 16px; }

      .avocado-dl-divider {
        width: 1px;
        background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.12), transparent);
        align-self: stretch;
        flex-shrink: 0;
      }

      .avocado-dl-close {
        pointer-events: all;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        border: none;
        cursor: pointer;
        background: rgba(12, 16, 20, 0.5);
        color: rgba(255,255,255,0.45);
        transition: all 0.15s ease;
        flex-shrink: 0;
        outline: none;
      }
      .avocado-dl-close svg { pointer-events: none; }
      .avocado-dl-close:hover { background: #c0392b; color: #fff; }
      .avocado-dl-close:active { background: #962d22; }

      .avocado-dl-btn.sent {
        background: linear-gradient(135deg, #29b6f6, #1565c0) !important;
        color: #ffffff !important;
        filter: none !important;
      }
      .avocado-dl-btn.sent svg { fill: #ffffff !important; }

      @keyframes avocadoBarIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
    `;

    const bar = document.createElement('div');
    bar.className = 'avocado-dl-bar pos-top-right size-medium mode-full attached';

    const btn = document.createElement('button');
    btn.className = 'avocado-dl-btn';
    btn.setAttribute('title', 'Download with FDM');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <span class="btn-label">Download with FDM</span>
    `;

    const divider = document.createElement('div');
    divider.className = 'avocado-dl-divider';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'avocado-dl-close';
    closeBtn.setAttribute('title', 'Dismiss');
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    `;
    closeBtn.addEventListener('click', (e) => {
      if (suppressButtonClick) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (currentHoveredVideo && currentVideoTarget) {
        dismissedVideoElements.set(currentHoveredVideo, currentVideoTarget.url);
        if (isSpecificVideoUrl(currentVideoTarget.url)) dismissedKeys.add(currentVideoTarget.url);
      }

      hideOverlayButton();
      currentHoveredVideo = null;
    });

    bar.appendChild(btn);
    bar.appendChild(divider);
    bar.appendChild(closeBtn);

    shadow.appendChild(style);
    shadow.appendChild(bar);

    floatingBtn = { host, btn, bar, closeBtn, shadow };
    setupDragHandlers(floatingBtn);
    updateFloatingButtonStyles();
    return floatingBtn;
  }

  // ─── Drag support (whole bar is draggable) ──────────────────────────────────
  //
  // A 4px movement threshold distinguishes click from drag, so normal button
  // clicks (download, close) still work. Offset is in-memory only — it resets
  // on every page navigation so each video loads with the default position.

  const DRAG_THRESHOLD = 4; // px before a press becomes a drag

  function setupDragHandlers(ref) {
    const { bar } = ref;

    let startX = 0, startY = 0;
    let startOffset = { x: 0, y: 0 };
    let armed = false;

    function onPointerMove(e) {
      if (!armed) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!isDraggingButton) {
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          isDraggingButton = true;
          bar.classList.add('dragging');
          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        } else {
          return;
        }
      }

      e.preventDefault();
      floatingButtonOffset = { x: startOffset.x + dx, y: startOffset.y + dy };
      applyDragOffset();
    }

    function onPointerUp() {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      armed = false;
      isDragArmed = false;
      if (floatingBtn) floatingBtn.bar.classList.remove('idle');

      if (isDraggingButton) {
        isDraggingButton = false;
        bar.classList.remove('dragging');
        suppressButtonClick = true;
        setTimeout(() => { suppressButtonClick = false; }, 60);
      }
    }

    function startPress(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (mouseIdleTimer) { clearTimeout(mouseIdleTimer); mouseIdleTimer = null; }
      if (floatingBtn) floatingBtn.bar.classList.remove('idle');
      armed = true;
      isDragArmed = true;
      startX = e.clientX;
      startY = e.clientY;
      startOffset = { x: floatingButtonOffset.x, y: floatingButtonOffset.y };
      document.addEventListener('pointermove', onPointerMove, true);
      document.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('pointercancel', onPointerUp, true);
    }

    bar.addEventListener('pointerdown', (e) => {
      startPress(e);
    });
  }

  // ─── Document-Level Mouse Tracking ──────────────────────────────────────────
  // Instead of mouseenter on <video> (blocked by overlay divs on social media),
  // we track mouse position and check if it's over any video's bounding rect.

  function handleMouseMove(e) {
    if (isDraggingButton || isDragArmed) return;

    if (floatingBtn && floatingBtn.host.parentElement) {
      floatingBtn.bar.classList.remove('idle');
      if (mouseIdleTimer) clearTimeout(mouseIdleTimer);
      if (buttonIdleEnabled) {
        mouseIdleTimer = setTimeout(() => {
          if (floatingBtn && floatingBtn.host.parentElement) {
            floatingBtn.bar.classList.add('idle');
          }
        }, 4000);
      }
    }


    if (!showFloatingButton) return;
    onNavigate();
    for (const node of e.composedPath()) if (node.shadowRoot) watchRoot(node.shadowRoot);

    const videos = getMediaElements();
    let foundVideo = null;

    for (const video of videos) {
      if (!isRealVideoPlayer(video)) continue;
      if (minVideoDuration > 0 && video.duration > 0 && video.duration < minVideoDuration) continue;
      const rect = video.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        foundVideo = video;
        break;
      }
    }

    if (!foundVideo && floatingBtn && floatingBtn.host.parentElement) {
      const barRect = floatingBtn.bar.getBoundingClientRect();
      const pad = 6;
      if (e.clientX >= barRect.left - pad && e.clientX <= barRect.right + pad &&
          e.clientY >= barRect.top - pad && e.clientY <= barRect.bottom + pad) {
        if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        return;
      }
    }

    if (foundVideo) {
      const downloadInfo = getDownloadUrl(foundVideo);
      if (!downloadInfo || !downloadInfo.url) {
        currentHoveredVideo = null;
        currentVideoTarget = null;
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => hideOverlayButton(), 400);
        return;
      }

      if (isVideoDismissed(foundVideo, downloadInfo.url)) {
        hideOverlayButton();
        currentHoveredVideo = null;
        return;
      }

      if (foundVideo === currentHoveredVideo && currentVideoTarget?.url === downloadInfo.url) return;
      currentHoveredVideo = foundVideo;
      floatingButtonOffset = { x: 0, y: 0 };
      currentVideoTarget = { element: foundVideo, url: downloadInfo.url, isDirect: downloadInfo.isDirect };
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      showOverlayButton(foundVideo);
    } else if (!foundVideo && currentHoveredVideo) {
      currentHoveredVideo = null;
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => hideOverlayButton(), 400);
    }
  }
  let pendingPointer;
  document.addEventListener('mousemove', event => {
    const path = event.composedPath();
    pendingPointer = { clientX: event.clientX, clientY: event.clientY, composedPath: () => path };
    if (mouseMoveThrottle) return;
    mouseMoveThrottle = requestAnimationFrame(() => {
      mouseMoveThrottle = null;
      handleMouseMove(pendingPointer);
    });
  }, { passive: true });

  function showOverlayButton(videoElement) {
    const { host, btn, bar, shadow } = createFloatingButton();

    // Use fixed positioning based on video's bounding rect
    const rect = videoElement.getBoundingClientRect();
    host.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
    `;

    // Remove from previous parent if any
    if (host.parentElement) host.remove();
    (document.fullscreenElement || document.body).appendChild(host);

    // Re-trigger fade-in animation
    bar.style.animation = 'none';
    bar.offsetHeight;
    bar.style.animation = 'avocadoBarIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
    applyDragOffset();

    // Update label text (ignored in mini mode where the label is hidden)
    const labelEl = btn.querySelector('.btn-label');
    if (labelEl) {
      labelEl.textContent = currentVideoTarget && !currentVideoTarget.isDirect
        ? 'Download with FDM'
        : 'Download with FDM';
    }

    // Click handler on main download button
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Ignore the click that ends a drag gesture (flag auto-clears via timeout)
      if (suppressButtonClick) return;
      if (btn.classList.contains('sent')) return;

      if (currentVideoTarget) {
        if (!isExtensionContextValid()) {
          if (labelEl) labelEl.textContent = 'Please refresh page';
          setTimeout(() => {
            if (labelEl) {
              labelEl.textContent = currentVideoTarget && !currentVideoTarget.isDirect
                ? 'Download with FDM'
                : 'Download with FDM';
            }
          }, 2500);
          return;
        }

        const freshTarget = getDownloadUrl(currentVideoTarget.element);
        if (!freshTarget) { if (labelEl) labelEl.textContent = 'Video changed. Hover again.'; return; }
        btn.classList.add('sent');
        if (labelEl) labelEl.textContent = 'Requesting…';
        safeSendMessage({ type: 'DOWNLOAD_AS', ...freshTarget, pageUrl: location.href }, response => {
          btn.classList.remove('sent');
          btn.title = response?.error || response?.message || 'No response. Refresh the page.';
          if (labelEl) labelEl.textContent = response?.error ? 'Try again — see tooltip'
            : response?.viaFdm ? 'Check FDM' : response?.ok ? 'Download started' : 'Refresh this page';
        });
      }
    };
  }

  function hideOverlayButton() {
    if (isDraggingButton) return;
    if (mouseIdleTimer) { clearTimeout(mouseIdleTimer); mouseIdleTimer = null; }
    if (floatingBtn && floatingBtn.host.parentElement) {
      floatingBtn.host.remove();
    }
    currentVideoTarget = null;
  }

  // Update button position on scroll/resize (for fixed positioning)
  let scrollThrottle = null;
  function onScrollResize() {
    if (scrollThrottle) return;
    scrollThrottle = setTimeout(() => { scrollThrottle = null; }, 100);

    if (currentHoveredVideo && floatingBtn && floatingBtn.host.parentElement) {
      const rect = currentHoveredVideo.getBoundingClientRect();
      floatingBtn.host.style.top = `${rect.top}px`;
      floatingBtn.host.style.left = `${rect.left}px`;
      floatingBtn.host.style.width = `${rect.width}px`;
      floatingBtn.host.style.height = `${rect.height}px`;
      applyDragOffset();
    }
  }
  window.addEventListener('scroll', onScrollResize, { passive: true, capture: true });
  document.addEventListener('fullscreenchange', () => {
    if (currentHoveredVideo && currentVideoTarget) showOverlayButton(currentHoveredVideo);
  });
  window.addEventListener('resize', onScrollResize, { passive: true });

  // ─── Listen for settings changes ────────────────────────────────────────────

  if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.settings) {
        const newSettings = changes.settings.newValue;
        applyLoadedSettings(newSettings);
        if (newSettings && newSettings.floatingButtonOffset &&
            newSettings.floatingButtonOffset.x === 0 &&
            newSettings.floatingButtonOffset.y === 0 &&
            (floatingButtonOffset.x !== 0 || floatingButtonOffset.y !== 0)) {
          floatingButtonOffset = { x: 0, y: 0 };
          updateFloatingButtonStyles();
        }
        if (!showFloatingButton) {
          hideOverlayButton();
        }
      }
    });
  }

  // ─── Active Video Detector for Popup ────────────────────────────────────────

  function getActiveVideo() {
    try {
      const href = window.location.href;
      const hostname = window.location.hostname;
      const videos = getMediaElements();
      let bestVideo = null;

      // Step 1: Prioritize currently playing (unpaused) video players
      for (const video of videos) {
        if (isRealVideoPlayer(video) && !video.paused) {
          bestVideo = video;
          break;
        }
      }

      // Step 2: Fallback to largest visible viewport video
      if (!bestVideo) {
        let maxVisibleArea = 0;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        for (const video of videos) {
          if (!isRealVideoPlayer(video)) continue;
          const rect = video.getBoundingClientRect();

          const xOverlap = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
          const yOverlap = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
          const visibleArea = xOverlap * yOverlap;

          if (visibleArea > maxVisibleArea) {
            maxVisibleArea = visibleArea;
            bestVideo = video;
          }
        }
      }

      if (bestVideo) {
        const downloadInfo = getDownloadUrl(bestVideo);
        if (downloadInfo && downloadInfo.url) {
          return {
            url: downloadInfo.url,
            isDirect: downloadInfo.isDirect,
            pageTitle: document.title,
            thumbnail: getPageThumbnail()
          };
        }
      }

      // Fallback: only if we are on a specific post/video detail page, not a general feed
      const isPostPage = (AvocadoUrls.hostMatches(hostname, 'instagram.com') && /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i.test(href)) ||
                         ((AvocadoUrls.hostMatches(hostname, 'twitter.com') || AvocadoUrls.hostMatches(hostname, 'x.com')) && /\/status\/\d+/i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'tiktok.com') && /(\/video\/|\/photo\/|\/v\/)\d+/i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'reddit.com') && /\/comments\//i.test(href)) ||
                         (AvocadoUrls.hostMatches(hostname, 'facebook.com') && /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i.test(href));

      if (isPostPage) {
        return {
          url: href,
          isDirect: false,
          pageTitle: document.title,
          thumbnail: getPageThumbnail()
        };
      }
    } catch (e) {
      console.log('AvocadoDL: Error getting active video:', e);
    }
    return null;
  }

  // Listen for messages from the popup panel
  if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_ACTIVE_VIDEO') {
        const activeVideo = getActiveVideo();
        sendResponse({ activeVideo });
      }

    });
  }

})();
