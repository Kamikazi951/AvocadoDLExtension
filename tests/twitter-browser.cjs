/* X-shaped local fixtures: no account, cookie access, or live X API calls. */
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'avocado-twitter-'));let context;
 try{
  const root=path.resolve(__dirname,'..');
  context=await chromium.launchPersistentContext(temp,{executablePath:process.env.AVOCADO_BROWSER,channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
  const cdp=await context.browser().newBrowserCDPSession();const extension=await cdp.send('Extensions.loadUnpacked',{path:root});
  const poster='https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg?name=small';
  const targets=[];
  await context.route('https://pbs.twimg.com/**',r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD14AAAAASUVORK5CYII=','base64')}));
  await context.route('https://video.twimg.com/**',r=>{targets.push(r.request().url());return r.fulfill({status:200,contentType:'video/mp4',body:'fixture'});});
  await context.route('https://x.com/**',route=>{
   const url=route.request().url();
   if(url.includes('/i/api/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{result:{media:[
    {media_url_https:'https://pbs.twimg.com/ext_tw_video_thumb/999/pu/img/other.jpg',video_info:{variants:[{url:'https://video.twimg.com/wrong.mp4',bitrate:9000}]}},
    {media_url_https:poster,video_info:{variants:[{url:'https://video.twimg.com/low.mp4',content_type:'video/mp4',bitrate:100},
     {url:'https://video.twimg.com/'+(url.includes('xhr')?'xhr-best':'best')+'.mp4',content_type:'video/mp4',bitrate:1000},
     {url:'https://video.twimg.com/stream.m3u8',content_type:'application/x-mpegURL'}]}}
   ]}}})});
   if(url.endsWith('/fixture.js'))return route.fulfill({contentType:'text/javascript',body:`
     const player=document.querySelector('video');player.src=URL.createObjectURL(new MediaSource());
     fetch('/i/api/graphql/Fixture/TweetResult').then(r=>r.json()).then(()=>document.body.dataset.ready='yes');
     document.querySelector('button').onclick=()=>{const request=new XMLHttpRequest();request.open('GET','/i/api/graphql/xhr/TweetResult');request.send();};
   `});
   return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><title>X media fixture</title><body style="margin:80px"><article><a href="/user/status/111">Post</a><video style="width:480px;height:270px" poster="${poster}" controls></video></article><button>XHR update</button><script src="/fixture.js"></script>`});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://x.com/user/status/111');
  await page.waitForFunction(()=>document.body.dataset.ready==='yes');
  const popup=await context.newPage();await popup.goto('chrome-extension://'+extension.id+'/popup.html');
  const worker=context.serviceWorkers().find(w=>w.url().includes(extension.id));
  const tabId=(await worker.evaluate(()=>chrome.tabs.query({}))).find(t=>t.url==='https://x.com/user/status/111').id;
  async function target(expected){for(let i=0;i<30;i++){const v=await worker.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'GET_ACTIVE_VIDEO'}),tabId);if(v?.activeVideo?.url===expected)return v.activeVideo;await new Promise(r=>setTimeout(r,100));}throw Error('Media mapping failed: '+expected);}
  const media=await target('https://video.twimg.com/best.mp4');assert.equal(media.isDirect,true);
  console.log('PASS: fetch response maps the correct X video poster to its highest-bitrate MP4');
  const start=Date.now();await worker.evaluate(({url,tabId})=>download({type:'DOWNLOAD',url,isDirect:true,tabId}),{url:media.url,tabId});
  for(let i=0;i<30&&!targets.length;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(new URL(targets[0]).pathname,'/best.mp4');assert(new URL(targets[0]).searchParams.has('fdmguid'));
  assert(Date.now()-start<2000,'cached handoff must not wait for a second metadata fetch');
  console.log('PASS: cached X MP4 sent from the page to FDM without refetching tweet metadata');
  await page.locator('button').click();await target('https://video.twimg.com/xhr-best.mp4');
  console.log('PASS: XHR response updates media for the same player');
  await page.locator('video').hover();await page.locator('#avocadodl-host').waitFor();
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','twitter.png')});
  assert.deepEqual(errors,[]);
 }finally{await context?.close();assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'avocado-twitter-'));await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
