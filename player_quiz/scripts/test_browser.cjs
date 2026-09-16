const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Quiz=require('../engine.js');
const version=JSON.parse(fs.readFileSync('player_quiz/data/manifest.json','utf8')).version;
const data=JSON.parse(fs.readFileSync(`player_quiz/data/${version}.json`,'utf8'));
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='http://127.0.0.1:8765/player_quiz/';
 await page.goto(origin+'admin.html',{waitUntil:'domcontentloaded'});await page.locator('#generate').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#generate').disabled);
 await page.selectOption('#scope','history');await page.selectOption('#level','hard');await page.selectOption('#count','5');await page.click('#generate');
 const url=await page.inputValue('#share-url');assert(!url.includes('admin'));const config=Quiz.decode(new URLSearchParams(new URL(url).hash.slice(1)).get('q'));const deck=Quiz.questions(data,config);
 await page.goto(url);await page.click('#start');assert.equal(await page.locator('#hints .hint').count(),1);
 let expected=0;
 for(let i=0;i<5;i++){
   if(i===1){await page.click('#hint');assert.equal(await page.locator('#hints .hint').count(),2);}
   if(i===2)await page.click('#skip');
   else {await page.click(`[data-id="${deck[i].answer.id}"]`);expected+=i===1?80:100;}
   assert.equal(await page.locator('.option:disabled').count(),4);
   await page.click('#next');
 }
 assert((await page.locator('.score').innerText()).includes(String(expected)));
 await page.click('#copy-result');const copied=await page.evaluate(()=>navigator.clipboard.readText());assert(copied.includes('380 / 500'));assert(copied.includes('4/5'));assert(copied.includes(url));assert(!copied.includes('admin.html'));
 assert.equal(await page.locator('#creator').count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'player_quiz/result-mobile.png',fullPage:true});
 await page.click('#retry');await page.click('[data-id]');await page.click('#next');
 await page.goto(origin+'#q=broken');await page.getByText('게임을 열 수 없어요').waitFor();
 // Clipboard rejection must expose a manual-copy fallback.
 await page.goto(url);await page.click('#start');for(let i=0;i<5;i++){await page.click('#skip');await page.click('#next');}
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(Error('denied'))},configurable:true}));
 await page.click('#copy-result');assert(await page.locator('#copy-fallback').isVisible());
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin);await page.locator('#start').waitFor();await page.screenshot({path:'player_quiz/landing-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: mobile creator → fixed link → hints → 5 answers → 380/500 → clipboard; retry, errors, fallback, desktop');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
