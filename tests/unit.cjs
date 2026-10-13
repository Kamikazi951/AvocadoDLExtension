const { test } = require('node:test');
const assert = require('node:assert/strict');
const urls = require('../urls.js');
const twitter = require('../twitter-media.js');

test('marker precedes fragment, replaces duplicates and preserves signed query encoding', () => {
  const value = urls.fdmUrl('https://example.org/watch?token=a%20b%2Fc+z&fdmguid=old#video');
  assert.equal(value, 'https://example.org/watch?token=a%20b%2Fc+z&fdmguid=6d36f5b5519148d69647a983ebd677fc#video');
});
test('generic pages and streaming manifests are parsed rather than saved as HTML or playlists', () => {
  for (const url of ['https://example.org/watch/123', 'https://cdn.org/live.M3U8?token=1', 'https://cdn.org/a.mpd']) {
    assert.equal(urls.route(url).viaFdm, true);
  }
  assert.equal(urls.route('https://example.org/stream', { isDirect: true }).viaFdm, false);
  assert.equal(urls.route('https://cdn.org/a.mp4?token=a%20b').requestUrl, 'https://cdn.org/a.mp4?token=a%20b');
});
test('blob links fall back to the frame page', () => {
  assert.equal(urls.route('blob:https://example.org/123', { pageUrl: 'https://example.org/watch' }).url, 'https://example.org/watch');
  assert.throws(() => urls.route('blob:null/123'));
});
test('reject unsafe URL schemes, credentials and spoofed social domains', () => {
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.org/']) assert.throws(() => urls.route(url));
  assert.equal(urls.isSocial('https://notx.com/a'), false);
  assert.equal(urls.isSocial('https://x.com.example.org/a'), false);
  assert.equal(urls.isSocial('https://m.youtube.com/watch?v=abc'), true);
  assert.equal(urls.isSocial('https://threads.com/@a/post/b'), true);
});

test('Twitter chooses highest-bitrate MP4 for each distinct poster, not HLS or quoted media', () => {
  const variants = [{url:'https://video.twimg.com/a.m3u8',bitrate:99999},
    {url:'https://video.twimg.com/low.mp4',bitrate:100,content_type:'video/mp4'},
    {url:'https://video.twimg.com/high.mp4',bitrate:500,content_type:'video/mp4'}];
  const media = twitter.extract({data:{tweet:{extended_entities:{media:[
    {media_url_https:'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg?name=small',video_info:{variants}},
    {media_url_https:'https://pbs.twimg.com/ext_tw_video_thumb/456/pu/img/quote.jpg',video_info:{variants:[{url:'https://video.twimg.com/quote.mp4'}]}}
  ]}}}});
  assert.equal(media.length,2);
  assert.equal(media.find(m=>m.key==='media:123').url,'https://video.twimg.com/high.mp4');
  assert.equal(twitter.posterKey('https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg?name=large'),'media:123');
});
test('Twitter rejects deceptive domains and handles unified cards and circular structures', () => {
  assert.equal(twitter.bestVariant([{url:'https://video.twimg.com.evil.org/video.mp4',bitrate:100}]),null);
  const value={key:'unified_card',value:{string_value:JSON.stringify({media_entities:{a:{
    media_url_https:'https://pbs.twimg.com/tweet_video_thumb/a.jpg',video_info:{variants:[{url:'https://video.twimg.com/tweet_video/a.mp4'}]}
  }}})}};
  value.self=value;
  assert.equal(twitter.extract(value).length,1);
});
test('shipped UI text is valid UTF-8 without the screenshot mojibake', () => {
  const fs=require('node:fs'),path=require('node:path');
  for(const file of ['manifest.json','content.js','injected.js','popup.js','popup.html']) {
    const text=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert(!/[\u00e2][\u20ac\u2500]|\u00f0\u0178|\ufffd/.test(text),file+' contains corrupt text');
  }
});
