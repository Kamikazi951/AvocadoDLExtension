/* Independent media selection from X responses. No API tokens, private endpoint
 * IDs or third-party download service. Shared by both extension worlds/tests. */
(function(root) {
  'use strict';
  function cdnUrl(value, host) {
    if (typeof value !== 'string' || value.length > 16384) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function posterKey(value) {
    const url = cdnUrl(value, 'pbs.twimg.com');
    if (!url) return null;
    // Thumbnail query parameters can change between feed and detail views.
    const id = url.pathname.match(/\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//);
    return id ? 'media:' + id[1] : url.origin + url.pathname;
  }
  function bestVariant(variants) {
    if (!Array.isArray(variants)) return null;
    let best = null;
    for (const item of variants.slice(0, 50)) {
      const url = cdnUrl(item?.url || item?.src, 'video.twimg.com');
      if (!url || !/\.mp4$/i.test(url.pathname) || (item.content_type && item.content_type !== 'video/mp4')) continue;
      const bitrate = Number(item.bitrate) || 0;
      if (!best || bitrate > best.bitrate) best = { url: url.href, bitrate };
    }
    return best;
  }
  function extract(payload) {
    const found = new Map();
    const visited = new WeakSet();
    const queue = [payload];
    for (let index = 0; index < queue.length && index < 10000; index++) {
      const node = queue[index];
      if (!node || typeof node !== 'object' || visited.has(node)) continue;
      visited.add(node);
      const best = bestVariant(node.video_info?.variants || node.videoInfo?.variants);
      const poster = node.media_url_https || node.media_url || node.preview_image_url;
      const key = posterKey(poster);
      if (best && key) {
        const previous = found.get(key);
        if (!previous || best.bitrate > previous.bitrate) found.set(key, { ...best, poster, key });
      }
      if (found.size >= 100) break;
      // Unified cards encode media_entities in a JSON string.
      if (node.key === 'unified_card' && typeof node.value?.string_value === 'string' && node.value.string_value.length < 2_000_000) {
        try { queue.push(JSON.parse(node.value.string_value)); } catch {}
      }
      for (const value of Object.values(node)) {
        if (queue.length >= 10000) break;
        if (value && typeof value === 'object') queue.push(value);
      }
    }
    return [...found.values()];
  }
  root.AvocadoTwitter = { posterKey, bestVariant, extract };
  if (typeof module !== 'undefined') module.exports = root.AvocadoTwitter;
})(globalThis);
