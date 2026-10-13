/* Real MV3 extension in an isolated Chromium profile; no personal browser data. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const marked = [];
  const server = http.createServer((req, res) => {
    if (req.url.includes('fdmguid=')) marked.push(req.url);
    if (req.url.startsWith('/file.mp4') || req.url.startsWith('/second.mp4')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end('avocadodl-download-fixture'); return;
    }
    if (req.url.startsWith('/live.m3u8')) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nvariant.m3u8\n'); return;
    }
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(`
        document.querySelector('#copy').onclick = () => navigator.clipboard.writeText('https://youtu.be/fixture#time');
        document.querySelector('#swap').onclick = () => { document.querySelector('video').src='/second.mp4'; history.pushState({}, '', '/next'); };
        document.querySelector('#shadow').onclick = () => { const host=document.createElement('div'); host.id='shadow-player'; document.body.append(host); const shadow=host.attachShadow({mode:'open'}); shadow.innerHTML='<video style="width:320px;height:180px" src="/second.mp4" controls></video>'; };
        document.querySelector('#stream').onclick = () => fetch('/live.m3u8');
        document.querySelector('#frame').onclick = () => { const frame=document.createElement('iframe'); frame.srcdoc='<video style="width:280px;height:160px" src="/file.mp4" controls></video>'; document.body.append(frame); };
        document.querySelector('#source').onclick = () => { document.querySelector('video').removeAttribute('src'); const source=document.createElement('source'); source.src='/second.mp4'; document.querySelector('video').append(source); document.querySelector('video').load(); };
        document.querySelector('#blob').onclick = () => { document.querySelector('video').src=URL.createObjectURL(new MediaSource()); };
      `); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; media-src 'self' blob:; frame-src 'self' about:;" });
    res.end('<!doctype html><title>AvocadoDL compatibility fixture</title><body style="margin:70px"><video style="width:320px;height:180px" src="/file.mp4" controls></video><p><button id="copy">Copy link</button><button id="swap">Swap video</button><button id="shadow">Shadow player</button><button id="stream">Load stream</button><button id="frame">Embed</button><button id="source">Source child</button><button id="blob">Blob player</button></p><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'avocadodl-browser-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, channel: 'chromium', acceptDownloads: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      ...(process.env.AVOCADO_BROWSER ? { executablePath: process.env.AVOCADO_BROWSER } : {}),
      args: ['--enable-unsafe-extension-debugging', ...(process.env.AVOCADO_BROWSER ? [] : [`--disable-extensions-except=${root}`, `--load-extension=${root}`])]
    });
    if (process.env.AVOCADO_BROWSER) {
      // Branded Chrome uses the supported DevTools loader, not the removed
      // --load-extension command-line switch. This profile is disposable.
      const browserCdp = await context.browser().newBrowserCDPSession();
      const loaded = await browserCdp.send('Extensions.loadUnpacked', {path:root});
      console.log('Chrome loaded extension:', loaded.id);
    }
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:15000});
    console.log('Browser version:', context.browser().version());
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    const tabId = tabs.find(tab => tab.url.startsWith(base)).id;
    async function active(frameId = 0) {
      return worker.evaluate(({ tabId, frameId }) => chrome.tabs.sendMessage(tabId, { type: 'GET_ACTIVE_VIDEO' }, { frameId }), { tabId, frameId });
    }
    await page.locator('video').hover();
    const button = page.locator('#avocadodl-host');
    await button.waitFor({ state: 'visible' });
    assert.equal((await active()).activeVideo.url, base + '/file.mp4');
    console.log('PASS: MV3 injection, strict CSP, direct media and floating button');
    // The extension deliberately uses a closed shadow root. DevTools can inspect
    // it without changing the shipped implementation to make tests easier.
    const cdp = await context.newCDPSession(page);
    const tree = await cdp.send('DOM.getDocument', {depth:-1,pierce:true});
    function findClose(node) {
      const index = node.attributes?.indexOf('class');
      if (index >= 0 && node.attributes[index+1].split(' ').includes('avocado-dl-close')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = findClose(child); if (found) return found;
      }
    }
    const close = findClose(tree.root);
    assert(close, 'close control exists inside the closed shadow root');
    const {model} = await cdp.send('DOM.getBoxModel', {nodeId:close.nodeId});
    await page.mouse.click((model.border[0]+model.border[4])/2, (model.border[1]+model.border[5])/2);
    await page.locator('video').hover();
    assert.equal(await button.count(), 0);
    await page.locator('#swap').click();
    await page.locator('video').hover();
    await button.waitFor({ state: 'visible' });
    assert.equal((await active()).activeVideo.url, base + '/second.mp4');
    console.log('PASS: dismissal and reused player after SPA navigation');
    await page.locator('#shadow').click();
    await page.locator('#shadow-player video').hover();
    await button.waitFor({ state: 'visible' });
    console.log('PASS: dynamically created open shadow player');
    await page.locator('#source').click();
    assert.equal((await active()).activeVideo.url, base + '/second.mp4');
    await page.locator('#stream').click();
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('live.m3u8')));
    // A worker cannot message itself: inspect session data via Chrome's API.
    for (let attempt=0; ; attempt++) {
      const cached = await worker.evaluate(async tabId => (await chrome.storage.session.get('media:' + tabId))['media:' + tabId], tabId);
      if (cached?.some(item => item.url.endsWith('live.m3u8'))) break;
      assert(attempt < 30, 'manifest detection timed out');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('PASS: child source and network manifest detection');
    await page.locator('#frame').click();
    await page.frameLocator('iframe').locator('video').hover();
    await page.frameLocator('iframe').locator('#avocadodl-host').waitFor({state:'visible'});
    console.log('PASS: about:srcdoc embedded player');
    await page.locator('#copy').click();
    await page.locator('.avocado-clipboard-pill').waitFor({state:'visible'});
    console.log('PASS: MAIN-world clipboard capture under strict CSP');
    await page.locator('#blob').click();
    await page.waitForFunction(() => document.querySelector('video').currentSrc.startsWith('blob:'));
    const blobTarget = (await active()).activeVideo;
    assert.equal(blobTarget.url, base + '/next');
    assert.equal(blobTarget.isDirect, false);
    console.log('PASS: blob playback uses the page instead of a stale child source');
    const result = await worker.evaluate(url => download({type:'DOWNLOAD',url,isDirect:true,destination:'chrome'}), base + '/file.mp4');
    assert(result.downloadId >= 0);
    let entry;
    for (let i=0; i<30; i++) {
      entry = (await worker.evaluate(id => chrome.downloads.search({id}), result.downloadId))[0];
      if (entry.state === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(entry.state, 'complete');
    assert.equal(await fs.readFile(entry.filename, 'utf8'), 'avocadodl-download-fixture');
    await fs.unlink(entry.filename);
    console.log('PASS: real Chrome download completed with exact file contents');
    const handoff = await worker.evaluate(({url,tabId}) => download({type:'DOWNLOAD',url,isDirect:false,tabId}), {url:base + '/watch?signature=a%20b#video',tabId});
    assert.equal(handoff.status, 'requested');
    for(let i=0;i<30&&!marked.length;i++) await new Promise(resolve=>setTimeout(resolve,100));
    assert(marked.some(url => url.includes('signature=a%20b&fdmguid=')));
    console.log('PASS: FDM request marker, generic page routing, honest pending status');
    await worker.evaluate(tabId => chrome.tabs.update(tabId, {active:true}), tabId);
    const popupEvent = context.waitForEvent('page');
    await worker.evaluate(() => chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false}));
    const popup = await popupEvent;
    await popup.setViewportSize({width:320,height:600});
    await popup.locator('#download-page').waitFor();
    await popup.locator('#media-list button').first().waitFor();
    assert(await popup.locator('#download-page').isEnabled());
    assert((await popup.locator('#media-list button').count()) >= 2);
    await popup.locator('#media-list button').filter({hasText:'Stream · '}).first().click();
    await popup.locator('#download-status').filter({hasText:'Request sent from this page'}).waitFor();
    console.log('PASS: toolbar lists captured streams and requests the selected download');
    await popup.locator('h1').scrollIntoViewIfNeeded();
    await popup.screenshot({path:path.join(root,'test-results','popup.png'), fullPage:true});
    assert.deepEqual(errors, []);
    console.log('PASS: popup renders; no page JavaScript exceptions');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep + 'avocadodl-browser-'));
    await fs.rm(profile, {recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
