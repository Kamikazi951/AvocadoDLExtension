/* Opt-in integration probe. Uses a temporary copy of the installed official FDM
 * extension, its real native host, and a local test file. Never personal tabs. */
const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  if (!process.env.AVOCADO_FDM_EXTENSION) throw Error('Set AVOCADO_FDM_EXTENSION to the installed official FDM extension directory.');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'avocadodl-fdm-'));
  const official = path.join(temp, 'official-fdm');
  await fs.cp(process.env.AVOCADO_FDM_EXTENSION, official, {recursive:true});
  // Instrument a disposable copy at the existing native boundary. Calls still
  // go through the original SchemeHandler, request manager and real native host.
  await fs.appendFile(path.join(official, 'dist/js/service_worker.js'), `
globalThis.avocadoProbe = {calls:[], responses:[]};
globalThis.avocadoNativeReady = () => !!fdmext?.nhManager?.ready;
const avocadoOriginalPost = FdmNativeHostManager.prototype.postMessage;
FdmNativeHostManager.prototype.postMessage = function(task, callback) {
  const test = task.type === 'create_downloads' && task.create_downloads.downloads.some(d => d.url.includes('/avocadodl-bridge-check.txt'));
  if (test) avocadoProbe.calls.push({url:task.create_downloads.downloads[0].url, ready:this.ready});
  return avocadoOriginalPost.call(this, task, test ? function(response) {
    avocadoProbe.responses.push({error:response.error || '', result:response.result});
    if (callback) callback(response);
  } : callback);
};
`);
  const server = http.createServer((req,res) => {
    res.setHeader('Content-Type',req.url.includes('.txt') ? 'text/plain' : 'text/html');
    res.end(req.url.includes('.txt') ? 'AvocadoDL local handoff test.' : '<title>AvocadoDL FDM bridge check</title><body style="margin:80px"><video width="400" height="220" src="/avocadodl-bridge-check.txt" controls></video><p>Local integration check</p>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  let context;
  try {
    context=await chromium.launchPersistentContext(path.join(temp,'profile'),{
      executablePath:process.env.AVOCADO_BROWSER, channel:'chromium', headless:true,
      ignoreDefaultArgs:['--disable-extensions'], args:['--enable-unsafe-extension-debugging']
    });
    const cdp=await context.browser().newBrowserCDPSession();
    const fdm=await cdp.send('Extensions.loadUnpacked',{path:official});
    const avocado=await cdp.send('Extensions.loadUnpacked',{path:root});
    const page=await context.newPage(); await page.goto(base);
    // Wake both extension workers without creating a download.
    const popup=await context.newPage(); await popup.goto('chrome-extension://'+fdm.id+'/src/html/settings.html');
    const avocadoPopup=await context.newPage(); await avocadoPopup.goto('chrome-extension://'+avocado.id+'/popup.html');
    async function waitFor(check,label) {
      for(let i=0;i<100;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,100));}
      throw Error('Timed out: '+label);
    }
    const fdmWorker=await waitFor(()=>context.serviceWorkers().find(w=>w.url().includes(fdm.id)), 'official FDM worker');
    const worker=await waitFor(()=>context.serviceWorkers().find(w=>w.url().includes(avocado.id)), 'AvocadoDL worker');
    await waitFor(()=>fdmWorker.evaluate(()=>avocadoNativeReady()),'native FDM handshake');
    console.log('PASS: official FDM extension and real native host handshake');
    const url=base+'/avocadodl-bridge-check.txt?fdmguid=6d36f5b5519148d69647a983ebd677fc';
    if (process.env.AVOCADO_PROBE_BASELINE) {
      await worker.evaluate(async url=>{const r=await fetch(url);await r.body?.cancel();},url);
      await new Promise(r=>setTimeout(r,700));
      const before=await fdmWorker.evaluate(()=>avocadoProbe.calls.length);
      console.log('Background-worker fetch reached FDM:',before);
      await page.evaluate(url=>{fetch(url,{mode:'no-cors'}).then(r=>r.body?.cancel()).catch(()=>{});},url);
    } else {
      await page.bringToFront();
      await page.locator('video').hover();
      await page.locator('#avocadodl-host').waitFor();
      const pageCdp=await context.newCDPSession(page);
      const tree=await pageCdp.send('DOM.getDocument',{depth:-1,pierce:true});
      function findButton(node) {
        const i=node.attributes?.indexOf('class');
        if(i>=0&&node.attributes[i+1].split(' ').includes('avocado-dl-btn'))return node;
        for(const child of [...(node.children||[]),...(node.shadowRoots||[])]) { const found=findButton(child);if(found)return found; }
      }
      const node=findButton(tree.root);assert(node,'floating download button exists');
      const {model}=await pageCdp.send('DOM.getBoxModel',{nodeId:node.nodeId});
      await page.mouse.click((model.border[0]+model.border[4])/2,(model.border[1]+model.border[5])/2);
      console.log('Clicked the real floating Download with FDM button');
    }
    const calls=await waitFor(async()=>{const v=await fdmWorker.evaluate(()=>avocadoProbe.calls);return v.length?v:null;},'FDM create_downloads');
    assert.equal(calls.length,1,'each click must reach FDM exactly once');
    assert.equal(calls[0].ready,true);
    console.log('PASS: marked URL received by official FDM and submitted to its connected native host');
    // Some FDM versions respond only after the user accepts/cancels its dialog.
    await new Promise(r=>setTimeout(r,1000));
    console.log('Native acknowledgement:',await fdmWorker.evaluate(()=>avocadoProbe.responses));
  } finally {
    await context?.close(); await new Promise(resolve=>server.close(resolve));
    assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'avocadodl-fdm-'));
    await fs.rm(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
