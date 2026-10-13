/* Shared URL rules for the worker, content scripts and popup. */
(function (root) {
  'use strict';
  const GUID = '6d36f5b5519148d69647a983ebd677fc';
  const SOCIAL_DOMAINS = ['instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'reddit.com', 'facebook.com', 'youtube.com', 'youtu.be', 'threads.net',
    'threads.com', 'bsky.app', 'pinterest.com', 'twitch.tv', 'vimeo.com'];
  function hostMatches(host, domain) {
    return host === domain || host.endsWith('.' + domain);
  }
  function httpUrl(value, base) {
    if (typeof value !== 'string' || value.length > 16384) return null;
    try {
      const url = new URL(value, base);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function isSocial(value) {
    const url = httpUrl(value);
    return !!url && SOCIAL_DOMAINS.some(domain => hostMatches(url.hostname, domain));
  }
  function isStream(value) {
    const url = httpUrl(value);
    return !!url && /\.(m3u8|mpd)$/i.test(url.pathname);
  }
  function isMedia(value) {
    const url = httpUrl(value);
    return !!url && /\.(mp4|webm|mkv|avi|mov|m4v|3gp|ogv|mp3|m4a|aac|ogg|opus|flac|wav|m3u8|mpd)$/i.test(url.pathname);
  }
  function fdmUrl(value) {
    const url = httpUrl(value);
    if (!url) throw new Error('Only HTTP and HTTPS download links are supported.');
    const hash = url.hash;
    url.hash = '';
    const raw = url.href;
    const split = raw.indexOf('?');
    const base = split < 0 ? raw : raw.slice(0, split);
    // Preserve signed query encoding when adding the interception marker.
    const params = split < 0 ? [] : raw.slice(split + 1).split('&').filter(Boolean)
      .filter(part => part.split('=')[0].toLowerCase() !== 'fdmguid');
    params.push('fdmguid=' + GUID);
    return base + '?' + params.join('&') + hash;
  }
  function route(value, { isDirect, pageUrl } = {}) {
    if (typeof value === 'string' && /^(blob|data):/.test(value)) {
      value = pageUrl;
      isDirect = false;
    }
    const parsed = httpUrl(value);
    if (!parsed) throw new Error('This page has no transferable download URL. Open the original video page.');
    const url = parsed.href;
    const viaFdm = isStream(url) || (isDirect !== true && (isDirect === false || isSocial(url) || !isMedia(url)));
    return { url, viaFdm, requestUrl: viaFdm ? fdmUrl(url) : url };
  }
  root.AvocadoUrls = { hostMatches, httpUrl, isSocial, isStream, isMedia, fdmUrl, route };
  if (typeof module !== 'undefined') module.exports = root.AvocadoUrls;
})(globalThis);
