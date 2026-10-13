const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const assert=require('node:assert/strict');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'avocado-context-'));
 const observer=path.join(temp,'observer');await fs.mkdir(observer);
 await fs.writeFile(path.join(observer,'manifest.json'),JSON.stringify({manifest_version:3,name:'FDM request visibility test',version:'1',permissions:['webRequest','storage'],host_permissions:['<all_urls>'],background:{service_worker:'worker.js'}}));
 await fs.writeFile(path.join(observer,'worker.js'),`globalThis.seen=[];chrome.webRequest.onBeforeRequest.addListener(d=>{if(d.url.includes('/probe-'))seen.push({url:d.url,initiator:d.initiator});},{urls:['<all_urls>']});`);
 const server=http.createServer((q,r)=>{r.setHeader('Content-Security-Policy',"connect-src 'none'");r.end('<title>Request context</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let context;
 try{
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath:process.env.AVOCADO_BROWSER,channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
  const cdp=await context.browser().newBrowserCDPSession();const o=await cdp.send('Extensions.loadUnpacked',{path:observer});const a=await cdp.send('Extensions.loadUnpacked',{path:path.resolve(__dirname,'..')});
  const page=await context.newPage();await page.goto(base);
  const popup=await context.newPage();await popup.goto('chrome-extension://'+a.id+'/popup.html');
  const target=await context.newPage();await target.goto('chrome-extension://'+o.id+'/manifest.json');
  for(let i=0;i<30&&context.serviceWorkers().length<2;i++)await new Promise(r=>setTimeout(r,100));
  const worker=context.serviceWorkers().find(w=>w.url().includes(a.id));const receiver=context.serviceWorkers().find(w=>w.url().includes(o.id));
  const tabId=(await worker.evaluate(()=>chrome.tabs.query({}))).find(t=>t.url===base+'/').id;
  await worker.evaluate(async url=>{const r=await fetch(url);await r.body.cancel();},base+'/probe-worker');
  for(const world of ['MAIN','ISOLATED']){
   const result=await worker.evaluate(({tabId,world,url})=>chrome.scripting.executeScript({target:{tabId},world,func:async url=>{try {const r=await fetch(url,{mode:'no-cors'});await r.body?.cancel();return 'request completed';}catch(e){return e.message;}},args:[url]}),{tabId,world,url:base+'/probe-'+world});
   console.log(world,result[0].result);
  }
  const seen=await receiver.evaluate(()=>seen);console.log('Visible to receiver:',seen);
  assert.deepEqual(seen.map(s=>new URL(s.url).pathname),['/probe-ISOLATED']);
  console.log('PASS: isolated content fetch is visible to FDM and works under restrictive page CSP');
 }finally{await context?.close();await new Promise(r=>server.close(r));assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'avocado-context-'));await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
