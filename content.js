/**
 * AvocadoDL — Content Script
 * 
 * Runs on every page. Responsibilities:
 * 1. Injects the page-context interceptor (injected.js)
 * 2. DOM Scanner — MutationObserver for <video>, <audio>, <source> elements
 * 3. Floating download button — document-level mouse tracking (works on social media)
 * 4. Message bridge — relays from injected.js → background service worker
 * 5. Thumbnail & title extraction for the popup
 */

(function() {
  'use strict';
  
  if (window.__avocadoDLContentScriptLoaded) return;
  window.__avocadoDLContentScriptLoaded = true;
  
  // ─── State ──────────────────────────────────────────────────────────────────
  
  const detectedUrls = new Set();
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
  let dismissedVideoElement = null;

  function updateAttachedState() {
    if (!floatingBtn) return;
    const bar = floatingBtn.bar;
    if (!bar) return;
    const isAttached = floatingButtonOffset.x === 0 && floatingButtonOffset.y === 0
                       && floatingButtonPosition === 'top-right';
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
    updateAttachedState();
  }

  function applyLoadedSettings(settings) {
    if (!settings) return;
    showFloatingButton = settings.showFloatingButton !== false;
    showClipboardPillSetting = settings.showClipboardPill !== false;
    floatingButtonSize = settings.floatingButtonSize || 'medium';
    floatingButtonPosition = settings.floatingButtonPosition || 'top-right';
    floatingButtonMode = settings.floatingButtonMode || 'full';
    updateFloatingButtonStyles();
  }

  // Load settings on startup
  chrome.storage.sync.get('settings', (result) => {
    applyLoadedSettings(result.settings);
  });
  
  // ─── 1. Inject Page-Context Script ──────────────────────────────────────────
  
  function injectPageScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = function() { this.remove(); };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.log('AvocadoDL: Could not inject page script:', e);
    }
  }
  
  injectPageScript();
  
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
      const separator = url.includes('?') ? '&' : '?';
      const fdmUrl = url + separator + 'fdmguid=6d36f5b5519148d69647a983ebd677fc';
      fetch(fdmUrl, { mode: 'no-cors' }).catch(() => {});
      
      const downloadBtn = pill.querySelector('.download');
      downloadBtn.textContent = '✓ Sent!';
      downloadBtn.style.background = 'linear-gradient(135deg, #2196F3, #64B5F6)';
      
      setTimeout(() => {
        dismissPill();
      }, 1000);
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
    if (!text) return;
    const cleanText = text.trim();
    const isSocialLink = /https?:\/\/(www\.)?(instagram\.com\/(p|reel|reels)\/|twitter\.com\/.+\/status\/|x\.com\/.+\/status\/|tiktok\.com\/(.+\/video\/\d+|t\/[a-zA-Z0-9_-]+)|reddit\.com\/r\/.+\/comments\/|facebook\.com\/.+\/(videos|watch|reel|posts)|youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/i.test(cleanText);
    if (isSocialLink) {
      displayClipboardPill(cleanText);
    }
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
  });

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
    if (!url || detectedUrls.has(url)) return;
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    
    detectedUrls.add(url);
    
    // Extract thumbnail and title info for the popup
    const pageTitle = document.title || '';
    const thumbnail = getPageThumbnail();
    
    chrome.runtime.sendMessage({
      type: 'MEDIA_FOUND',
      url: url,
      mediaType: mediaType || '',
      source: source || 'dom',
      size: -1,
      pageTitle: pageTitle,
      thumbnail: thumbnail
    }).catch(() => {});
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
    const src = element.src || element.currentSrc || element.getAttribute('src');
    if (!src) return null;
    if (src.startsWith('blob:') || src.startsWith('data:')) return null;
    return src;
  }
  
  function findSocialPostUrl(videoElement) {
    const hostname = window.location.hostname;
    const href = window.location.href;

    try {
      // 1. Check if we're already on a direct post page
      if (hostname.includes('instagram.com') && /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i.test(href)) {
        return href;
      }
      if ((hostname.includes('twitter.com') || hostname.includes('x.com')) && /\/status\/\d+/i.test(href)) {
        return href;
      }
      if (hostname.includes('tiktok.com') && /(\/video\/|\/photo\/|\/v\/)\d+/i.test(href)) {
        return href;
      }

      // TikTok feeds display videos inside containers with IDs like "xgwrapper-0-VIDEOID"
      if (hostname.includes('tiktok.com')) {
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
      if (hostname.includes('facebook.com') && /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i.test(href)) {
        return href;
      }
      if (hostname.includes('reddit.com') && /\/comments\//i.test(href)) {
        return href;
      }

      // 2. Identify the site-specific card container and link patterns
      let cardSelector = null;
      let pattern = null;

      if (hostname.includes('instagram.com')) {
        cardSelector = 'article';
        pattern = /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i;
      } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
        cardSelector = 'article, [data-testid="tweet"]';
        pattern = /\/status\/\d+/i;
      } else if (hostname.includes('tiktok.com')) {
        cardSelector = '[data-e2e="recommend-list-item"], [data-e2e="user-post-item-list"], div[class*="ItemContainer"], div[class*="RecommendItem"], div[class*="DivItemContainer"]';
        pattern = /(\/video\/|\/photo\/|\/v\/)\d+/i;
      } else if (hostname.includes('facebook.com')) {
        cardSelector = '[role="article"], div[data-testid="fbfeed_story"], div[class*="userContentWrapper"]';
        pattern = /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i;
      } else if (hostname.includes('reddit.com')) {
        cardSelector = 'shreddit-post, [data-testid="post-container"], div.Post, [role="article"]';
        pattern = /\/comments\/[a-zA-Z0-9]+/i;
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

      // Method 2: Climb up DOM ancestors as a backup DOM check
      let curr = videoElement;
      while (curr && curr !== document.body) {
        const links = curr.querySelectorAll('a');
        for (const link of links) {
          if (link.href && pattern.test(link.href)) {
            if (!link.href.includes('/tagged/') && !link.href.includes('/liked/') && !link.href.includes('/sharer/')) {
              return link.href;
            }
          }
        }
        curr = curr.parentElement;
      }

      // Method 3: Visual Layout Distance Fallback (if DOM is completely flat or obfuscated)
      const anchors = document.querySelectorAll('a');
      let closestLink = null;
      let minDistance = Infinity;

      const videoRect = videoElement.getBoundingClientRect();
      const videoCenterX = videoRect.left + videoRect.width / 2;
      const videoCenterY = videoRect.top + videoRect.height / 2;

      for (const anchor of anchors) {
        if (anchor.href && pattern.test(anchor.href)) {
          if (anchor.href.includes('/tagged/') || anchor.href.includes('/liked/') || anchor.href.includes('/sharer/')) {
            continue;
          }
          const rect = anchor.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const anchorCenterX = rect.left + rect.width / 2;
          const anchorCenterY = rect.top + rect.height / 2;

          const dist = Math.sqrt(Math.pow(videoCenterX - anchorCenterX, 2) + Math.pow(videoCenterY - anchorCenterY, 2));
          if (dist < minDistance) {
            minDistance = dist;
            closestLink = anchor.href;
          }
        }
      }

      if (closestLink && minDistance < 1000) {
        console.log('AvocadoDL: Found closest link via visual distance:', closestLink, 'distance:', minDistance);
        return closestLink;
      }
    } catch (e) {
      console.log('AvocadoDL: Error resolving social post URL:', e);
    }

    return null;
  }

  function getDownloadUrl(videoElement) {
    const hostname = window.location.hostname;
    const href = window.location.href;
    
    if (hostname.includes('instagram.com') || 
        hostname.includes('twitter.com') || 
        hostname.includes('x.com') || 
        hostname.includes('tiktok.com') || 
        hostname.includes('reddit.com') || 
        hostname.includes('facebook.com')) {
      const postUrl = findSocialPostUrl(videoElement);
      if (postUrl) {
        return { url: postUrl, isDirect: false };
      }
      
      // Fallback: only allow the current page URL if it's a valid post page
      const isPostPage = (hostname.includes('instagram.com') && /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i.test(href)) ||
                         ((hostname.includes('twitter.com') || hostname.includes('x.com')) && /\/status\/\d+/i.test(href)) ||
                         (hostname.includes('tiktok.com') && /(\/video\/|\/photo\/|\/v\/)\d+/i.test(href)) ||
                         (hostname.includes('reddit.com') && /\/comments\//i.test(href)) ||
                         (hostname.includes('facebook.com') && /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i.test(href));
                         
      if (isPostPage) {
        return { url: href, isDirect: false };
      }
      
      // Do NOT fall back to feed homepage URLs (e.g. tiktok.com/ or x.com/home)
      return null;
    }

    const directSrc = extractMediaSrc(videoElement);
    if (directSrc) return { url: directSrc, isDirect: true };
    
    return { url: href, isDirect: false };
  }
  
  /**
   * Checks if a video element is big enough to be a real player (not a thumbnail).
   */
  function isRealVideoPlayer(videoElement) {
    const rect = videoElement.getBoundingClientRect();
    // Must be at least 50x50 pixels (covers small players, embeds, mobile frames)
    return rect.width >= 50 && rect.height >= 50 && rect.width > 0 && rect.height > 0;
  }
  
  // Handle SPA navigation (YouTube, Twitter, etc.)
  let lastUrl = window.location.href;
  
  function onNavigate() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      currentHoveredVideo = null;
      dismissedVideoElement = null;
      floatingButtonOffset = { x: 0, y: 0 };
      hideOverlayButton();
    }
  }
  
  // YouTube fires this custom event on navigation
  window.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);
  
  // Also catch pushState/replaceState
  const origPushState = history.pushState;
  history.pushState = function() {
    origPushState.apply(this, arguments);
    setTimeout(onNavigate, 100);
  };
  const origReplaceState = history.replaceState;
  history.replaceState = function() {
    origReplaceState.apply(this, arguments);
    setTimeout(onNavigate, 100);
  };
  
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
      }
      .avocado-dl-bar.dragging {
        animation: none !important;
        opacity: 1 !important;
        cursor: grabbing;
        transition: none !important;
        box-shadow: 0 0 0 1px rgba(124, 179, 66, 0.5);
      }

      .avocado-dl-bar.pos-top-right    { right: 0 !important; left: auto !important; bottom: auto !important; }
      .avocado-dl-bar.pos-top-right.size-small   { top: -32px !important; }
      .avocado-dl-bar.pos-top-right.size-medium  { top: -38px !important; }
      .avocado-dl-bar.pos-top-right.size-large   { top: -44px !important; }
      .avocado-dl-bar.pos-top-right.mode-mini.size-small  { top: -34px !important; }
      .avocado-dl-bar.pos-top-right.mode-mini.size-medium { top: -44px !important; }
      .avocado-dl-bar.pos-top-right.mode-mini.size-large  { top: -54px !important; }
      .avocado-dl-bar.pos-top-left     { top: 14px !important; left: 14px !important; right: auto !important; bottom: auto !important; }
      .avocado-dl-bar.pos-bottom-right { bottom: 14px !important; right: 14px !important; top: auto !important; left: auto !important; }
      .avocado-dl-bar.pos-bottom-left  { bottom: 14px !important; left: 14px !important; top: auto !important; right: auto !important; }

      .avocado-dl-bar { cursor: grab; }
      .avocado-dl-bar:active { cursor: grabbing; }
      .avocado-dl-bar.dragging { cursor: grabbing !important; }

      .avocado-dl-bar.attached {
        border-radius: 8px 8px 0 0 !important;
      }
      .avocado-dl-bar.attached.mode-mini {
        border-radius: 8px 8px 0 0 !important;
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

      .avocado-dl-bar.size-small .avocado-dl-btn  { padding: 7px 14px 7px 11px; font-size: 11.5px; gap: 7px; }
      .avocado-dl-bar.size-small .avocado-dl-btn svg { width: 13px; height: 13px; }
      .avocado-dl-bar.size-small .avocado-dl-close { width: 32px !important; }
      .avocado-dl-bar.size-large  .avocado-dl-btn { padding: 13px 24px 13px 19px; font-size: 14px; gap: 12px; }
      .avocado-dl-bar.size-large  .avocado-dl-close { width: 44px !important; }
      .avocado-dl-bar.size-large  .avocado-dl-btn svg { width: 18px; height: 18px; }

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
      .avocado-dl-bar.mode-mini.size-small .avocado-dl-btn { padding: 9px; }
      .avocado-dl-bar.mode-mini.size-small .avocado-dl-btn svg { width: 16px; height: 16px; }
      .avocado-dl-bar.mode-mini.size-large .avocado-dl-btn { padding: 15px; }
      .avocado-dl-bar.mode-mini.size-large .avocado-dl-btn svg { width: 24px; height: 24px; }

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
    btn.setAttribute('title', 'Download video (via FDM)');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <span class="btn-label">Download video (via FDM)</span>
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
      if (currentHoveredVideo) {
        dismissedVideoElement = currentHoveredVideo;
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

      if (isDraggingButton) {
        isDraggingButton = false;
        bar.classList.remove('dragging');
        suppressButtonClick = true;
        setTimeout(() => { suppressButtonClick = false; }, 60);
      }
    }

    function startPress(e) {
      if (e.button !== undefined && e.button !== 0) return;
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
  
  document.addEventListener('mousemove', (e) => {
    if (isDraggingButton || isDragArmed) return;

    if (mouseMoveThrottle) return;
    mouseMoveThrottle = setTimeout(() => { mouseMoveThrottle = null; }, 66);
    
    if (!showFloatingButton) return;
    
    const videos = document.querySelectorAll('video');
    let foundVideo = null;
    
    for (const video of videos) {
      if (!isRealVideoPlayer(video)) continue;
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
    
    if (foundVideo && foundVideo !== currentHoveredVideo) {
      if (dismissedVideoElement === foundVideo) return;

      const downloadInfo = getDownloadUrl(foundVideo);
      if (downloadInfo && downloadInfo.url) {
        currentHoveredVideo = foundVideo;
        currentVideoTarget = { element: foundVideo, url: downloadInfo.url, isDirect: downloadInfo.isDirect };
        if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        showOverlayButton(foundVideo);
      } else {
        currentHoveredVideo = null;
        currentVideoTarget = null;
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => hideOverlayButton(), 400);
      }
    } else if (!foundVideo && currentHoveredVideo) {
      currentHoveredVideo = null;
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => hideOverlayButton(), 400);
    }
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
    document.body.appendChild(host);
    
    // Re-trigger fade-in animation
    bar.style.animation = 'none';
    bar.offsetHeight;
    bar.style.animation = 'avocadoBarIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
    applyDragOffset();

    // Update label text (ignored in mini mode where the label is hidden)
    const labelEl = btn.querySelector('.btn-label');
    if (labelEl) {
      labelEl.textContent = currentVideoTarget && !currentVideoTarget.isDirect
        ? 'Download video (via FDM)'
        : 'Download video';
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
        chrome.runtime.sendMessage({
          type: 'MEDIA_FOUND',
          url: currentVideoTarget.url,
          mediaType: 'video/mp4',
          source: currentVideoTarget.isDirect ? 'dom' : 'page-url',
          pageTitle: document.title,
          thumbnail: getPageThumbnail()
        });
        
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_AS',
          url: currentVideoTarget.url
        });
        
        // Visual feedback — turn blue, show checkmark, auto-dismiss
        btn.classList.add('sent');
        if (labelEl) labelEl.textContent = '✓ Sent to FDM!';
        setTimeout(() => {
          btn.classList.remove('sent');
          if (labelEl) {
            labelEl.textContent = currentVideoTarget && !currentVideoTarget.isDirect
              ? 'Download video (via FDM)'
              : 'Download video';
          }
        }, 2000);
      }
    };
  }
  
  function hideOverlayButton() {
    if (isDraggingButton) return; // don't yank the button out mid-drag
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
    }
  }
  window.addEventListener('scroll', onScrollResize, { passive: true });
  window.addEventListener('resize', onScrollResize, { passive: true });
  
  // ─── Listen for settings changes ────────────────────────────────────────────
  
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

  // ─── Active Video Detector for Popup ────────────────────────────────────────

  function getActiveVideo() {
    try {
      const href = window.location.href;
      const hostname = window.location.hostname;
      const videos = document.querySelectorAll('video');
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
      const isPostPage = (hostname.includes('instagram.com') && /(\/p\/|\/reel\/|\/reels\/)[a-zA-Z0-9_-]+/i.test(href)) ||
                         ((hostname.includes('twitter.com') || hostname.includes('x.com')) && /\/status\/\d+/i.test(href)) ||
                         (hostname.includes('tiktok.com') && /(\/video\/|\/photo\/|\/v\/)\d+/i.test(href)) ||
                         (hostname.includes('reddit.com') && /\/comments\//i.test(href)) ||
                         (hostname.includes('facebook.com') && /(\/videos\/|\/watch\/|\/reel\/|\/posts\/|\/permalink\.php)/i.test(href));
                         
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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_ACTIVE_VIDEO') {
      const activeVideo = getActiveVideo();
      sendResponse({ activeVideo });
    }
    if (message.type === 'TRIGGER_FDM_FETCH') {
      fetch(message.url, { mode: 'no-cors' }).catch(() => {});
      sendResponse({ ok: true });
    }
    return true;
  });
  
})();
