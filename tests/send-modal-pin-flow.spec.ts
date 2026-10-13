import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { dashboardStyles } from "./fixtures/dashboard-render";

let script: string;
let css: string;
test.beforeAll(async () => {
    const [bundle, styles] = await Promise.all([
        build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import SendSingleModal from './src/components/SendSingleModal';
import MobileFloatingNav from './src/components/dashboard/MobileFloatingNav';
import {Home, Shield, Link2, Layers} from './src/components/icons';
import {fetchWithTransactionPin} from './src/lib/client/transactionPin';
import {cancelTransactionPinPrompt} from './src/components/TransactionPinPrompt';
const tabs=[{id:'home',label:'Home',icon:Home},{id:'commit',label:'Commit',icon:Shield},{id:'links',label:'Links',icon:Link2},{id:'batch',label:'Batch',icon:Layers}];
const address='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const quote=async({amount})=>({amountUsdc:amount,feeUsdc:'0.001',recipientUsdc:amount,totalDebitUsdc:String(Number(amount)+0.001),feeTreatment:'additional',feeLabel:'Network fee',arrival:'10 seconds',estimated:false});
window.cancelApproval=cancelTransactionPinPrompt;
function Fixture(){
 const [open,setOpen]=React.useState(false); const [recipient,setRecipient]=React.useState('alice.sub'); const [amount,setAmount]=React.useState('10'); const [loading,setLoading]=React.useState(false);
 window.closeSend=()=>setOpen(false);
 const submit=async(event,network,prompt)=>{
  setLoading(true);
  try {
   const body=JSON.stringify({receiverAddress:address,amountUsdc:amount});
   const response=await fetchWithTransactionPin('/api/user/wallet/send',{method:'POST',headers:{'Content-Type':'application/json'},body}, {operation:'Send USDC',details:{recipient:address,amountUsdc:amount}},prompt);
   const result=await response.json(); if(!response.ok)throw new Error(result.error||'Send failed');
   return {...await quote({amount}),...result,recipientAddress:address,networkId:network};
  } finally {setLoading(false);}
 };
 return <div className="user-dashboard-redesign" style={{height:'100dvh',background:'#FFFFF0'}}>
  <div className="user-dashboard-content"><button onClick={()=>setOpen(true)}>Open send</button></div>
  <MobileFloatingNav tabs={tabs} activeTab="home" onSelectTab={()=>{}} isLocked={open}/>
  <SendSingleModal open={open} onClose={()=>setOpen(false)} onSubmit={submit} getQuote={quote} recipient={recipient} onRecipientChange={setRecipient} amount={amount} onAmountChange={setAmount}
   resolving={false} resolved={{address,alias:'alice.sub',hasAccount:true}} selfSend={false} loading={loading} status={null} walletBalance={100} onScanQr={()=>{}} onGoToBatch={()=>{}} recentTransactions={[]}/>
 </div>;
} createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
            alias: { "@/lib/wagmi": path.resolve("tests/fixtures/deposit-chain.ts") }, define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } }),
        dashboardStyles(),
    ]);
    script = bundle.outputFiles[0].text; css = styles;
});

type Call = { path: string; body: unknown; headers: Record<string,string> };
async function fixture(page: Page, configured = true) {
    const calls: Call[] = [];
    const state = { missingToken: false, authorizationError: 'Incorrect transaction PIN.', holdAuthorization: false, holdSend: false, configured, releaseAuthorization: () => {}, releaseSend: () => {} };
    await page.route("**/*", async route => {
        const request=route.request(); const url=new URL(request.url());
        const asset=path.resolve('public',url.pathname.slice(1));
        if(asset.startsWith(path.resolve('public')+path.sep)&&fs.existsSync(asset)&&fs.statSync(asset).isFile()) return route.fulfill({path:asset});
        if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><body style="margin:0"><div id="root"></div></body></html>'});
        calls.push({path:url.pathname,body:request.postData()?request.postDataJSON():null,headers:request.headers()});
        if(url.pathname==='/api/user/transaction-pin')return route.fulfill({json:{configured:state.configured,required:true}});
        if(url.pathname==='/api/user/wallet/send') {
            if(!request.headers()['x-transaction-pin-token'])return route.fulfill({status:428,json:{code:'TRANSACTION_PIN_REQUIRED',challengeId:'challenge-1',configured:state.configured}});
            if(state.holdSend) await new Promise<void>(resolve=>state.releaseSend=resolve);
            return route.fulfill({json:{success:true,txHash:'0xabc',status:'confirmed'}});
        }
        if(url.pathname.endsWith('/authorize')) {
            if(state.holdAuthorization) await new Promise<void>(resolve=>state.releaseAuthorization=resolve);
            if(request.postDataJSON().pin!=='123456') return route.fulfill({status:403,json:{error:state.authorizationError}});
            return route.fulfill({json:{token:state.missingToken?'':'opaque-token'}});
        }
        return route.fulfill({json:{routes:[]}});
    });
    await page.goto('http://localhost:9877'); await page.addStyleTag({content:css}); await page.addScriptTag({content:script});
    await page.getByRole('button',{name:'Open send',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Send USDC',exact:true})).toBeVisible();
    await page.waitForTimeout(600);
    return {calls,state};
}
async function review(page: Page) {
    await page.getByTestId('send-review').click();
    await expect(page.locator('#sheet-page-content')).not.toHaveAttribute('inert');
    await page.getByRole('button',{name:'Slide to send',exact:true}).scrollIntoViewIfNeeded();
}
async function activate(page: Page) {
    if(await page.getByTestId('send-review').count()) await review(page);
    const slider=page.getByRole('button',{name:'Slide to send',exact:true});
    if(await slider.count()) {await slider.focus(); await page.keyboard.press('Enter');}
    else await page.getByRole('button',{name:'Send USDC',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();
    if(await page.locator('#sheet-page-content').count()) await expect(page.locator('#sheet-page-content')).not.toHaveAttribute('inert');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.locator('[data-send-pin-review]')).toHaveCount(0);
}
async function enter(page: Page,value='123456') {
    const keypad=page.getByRole('group',{name:'PIN keypad'});
    if(await keypad.isVisible()) {for(const digit of value) await keypad.getByRole('button',{name:digit,exact:true}).click();}
    else {const fields=page.locator('[data-pin-slot]'); for(let i=0;i<value.length;i++)await fields.nth(i).fill(value[i]);}
}
async function corners(page: Page) {
    const geometry=await page.getByTestId('send-sheet').evaluate(element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return {left:r.left,right:innerWidth-r.right,bottom:innerHeight-r.bottom,corners:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius]};});
    expect(geometry).toEqual({left:0,right:0,bottom:0,corners:['28px','28px','0px','0px']});
    await expect(page.locator('#mobile-nav-capsule')).toBeHidden(); await expect(page.locator('#wal')).toBeHidden();
}

for(const {width,height} of [{width:320,height:568},{width:390,height:844},{width:600,height:320},{width:1280,height:844}]) test(`actual Send authorization retries exact operation once in StrictMode at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height}); const {calls,state}=await fixture(page);
    if(width<=600){await corners(page);await review(page);await corners(page);}
    await activate(page); if(width<=600)await corners(page);
    await page.screenshot({path:info.outputPath('pin.png')});
    state.holdSend=true;
    await enter(page);
    const authorize=page.getByRole('button',{name:'Authorize',exact:true});await authorize.scrollIntoViewIfNeeded();
    expect(await authorize.evaluate(element=>{const r=element.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===element;})).toBe(true);
    await authorize.click();
    await expect.poll(()=>calls.filter(call=>call.headers['x-transaction-pin-token']).length).toBe(1);
    const sends=calls.filter(call=>call.path==='/api/user/wallet/send'); const auth=calls.filter(call=>call.path.endsWith('/authorize'));
    expect(auth).toHaveLength(1); expect(auth[0].body).toEqual({challengeId:'challenge-1',pin:'123456'});
    expect(sends).toHaveLength(2); expect(sends[1].body).toEqual(sends[0].body); expect(sends[1].headers['x-transaction-operation-id']).toBe(sends[0].headers['x-transaction-operation-id']); expect(sends[1].headers['x-transaction-pin-token']).toBe('opaque-token');
    if(width<=600){await corners(page);await expect(page.locator('#sheet-sending-hero')).toBeVisible();await page.locator('#sheet-sending-hero').evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});await page.screenshot({path:info.outputPath('sending.png')});}
    state.releaseSend();
    await expect(page.getByRole('button',{name:'Done',exact:true})).toBeVisible(); if(width<=600)await corners(page);
    await page.getByRole('dialog').evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
    await page.screenshot({path:info.outputPath('sent.png')});
});

test('Send reads enrollment before the swipe without creating a transaction and reuses the fresh setup check',async({page})=>{
    await page.setViewportSize({width:390,height:844}); const {calls}=await fixture(page);
    await expect.poll(()=>calls.filter(call=>call.path==='/api/user/transaction-pin').length).toBeGreaterThan(0);
    const setupReads=calls.filter(call=>call.path==='/api/user/transaction-pin').length;
    expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
    await activate(page);
    expect(calls.filter(call=>call.path==='/api/user/transaction-pin')).toHaveLength(setupReads);
    expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(1);
    expect(calls.filter(call=>call.path.endsWith('/authorize'))).toHaveLength(0);
    await page.getByRole('button',{name:'Back',exact:true}).click();
});

for (const { width, height, reducedMotion } of [
    { width: 390, height: 844, reducedMotion: 'no-preference' },
    { width: 320, height: 400, reducedMotion: 'no-preference' },
    { width: 390, height: 844, reducedMotion: 'reduce' },
] as const) test(`approved PIN enters Sending without flashing Review at ${width}px (${reducedMotion})`, async ({ page }, info) => {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion });
    const { calls, state } = await fixture(page); await activate(page); state.holdSend = true;
    await enter(page);
    await page.evaluate(() => {
        const state = window as unknown as { reviewFlashFrames: unknown[]; stopFlashCapture: boolean };
        state.reviewFlashFrames = []; state.stopFlashCapture = false;
        const sample = () => {
            const content = document.getElementById('sheet-page-content');
            const header = document.getElementById('sheet-review-header');
            const top = document.getElementById('sheet-review-top');
            const hero = document.getElementById('sheet-sending-hero');
            if (content && header && top && hero && Number(getComputedStyle(content).opacity) > 0.01) {
                const headerOpacity = Number(getComputedStyle(header).opacity);
                const topOpacity = Number(getComputedStyle(top).opacity);
                const heroOpacity = Number(getComputedStyle(hero).opacity);
                if (headerOpacity > 0.01 || topOpacity > 0.01 || heroOpacity < 0.99)
                    state.reviewFlashFrames.push({ headerOpacity, topOpacity, heroOpacity });
            }
            if (!state.stopFlashCapture) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: 'Authorize', exact: true }).click();
    await expect.poll(() => calls.filter(call => call.headers['x-transaction-pin-token']).length).toBe(1);
    await expect(page.locator('#sheet-page-content')).not.toHaveAttribute('inert');
    await page.waitForTimeout(350);
    const flashes = await page.evaluate(() => {
        const state = window as unknown as { reviewFlashFrames: unknown[]; stopFlashCapture: boolean };
        state.stopFlashCapture = true; return state.reviewFlashFrames;
    });
    expect(flashes).toEqual([]);
    await page.screenshot({ path: info.outputPath('direct-pin-to-sending.png') });
    state.releaseSend(); await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
});

test('server challenge still enforces enrollment changed after the earlier status read',async({page})=>{
    await page.setViewportSize({width:390,height:844}); const {calls,state}=await fixture(page);
    state.configured=false; await review(page);
    await page.getByRole('button',{name:'Slide to send',exact:true}).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading',{name:'Set up your transaction PIN',exact:true})).toBeVisible();
    expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(1);
    expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(0);
    await page.getByLabel('Back',{exact:true}).click();
});

test('expired enrollment snapshots are read again before any transfer request',async({page})=>{
    await page.setViewportSize({width:390,height:844}); const {calls,state}=await fixture(page); await review(page);
    const setupReads=calls.filter(call=>call.path==='/api/user/transaction-pin').length; state.configured=false;
    await page.evaluate(()=>{const now=Date.now; Date.now=()=>now()+31_000;});
    await page.getByRole('button',{name:'Slide to send',exact:true}).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading',{name:'Set up your transaction PIN',exact:true})).toBeVisible();
    expect(calls.filter(call=>call.path==='/api/user/transaction-pin')).toHaveLength(setupReads+1);
    expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
    await page.getByLabel('Back',{exact:true}).click();
});

test('wrong PIN stays inline, editing cancels old clear timer, retry authorizes the same challenge',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await activate(page);
    await enter(page,'999999');await page.getByRole('button',{name:'Authorize',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Incorrect');
    await enter(page,'1');await page.waitForTimeout(430);
    expect(await page.locator('[data-pin-slot]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLInputElement).value).join(''))).toBe('1');
    await enter(page,'23456');await page.getByRole('button',{name:'Authorize',exact:true}).click();await expect(page.getByRole('button',{name:'Done',exact:true})).toBeVisible();
    expect(calls.filter(call=>call.path.endsWith('/authorize'))).toHaveLength(2);expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(1);
});

for (const width of [390, 1280]) test(`generic PIN refusal stays off screen without authorizing the transfer at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:844}); const {calls,state}=await fixture(page);
    state.authorizationError='Transaction PIN authorization was refused.';
    await activate(page); await enter(page,'999999'); await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.locator('[data-pin-slot]').first()).toHaveAttribute('data-pin-slot-feedback','error');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Transaction PIN authorization was refused.',{exact:true})).toHaveCount(0);
    expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(0);
    await enter(page); await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.getByRole('button',{name:'Done',exact:true})).toBeVisible();
    expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(1);
});

test('Back restores a retryable review and never submits an authorized transfer',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await activate(page);
    await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toHaveCount(0);
    const slider=page.getByRole('button',{name:'Slide to send',exact:true});await expect(slider).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
    await activate(page);await enter(page);await page.getByRole('button',{name:'Authorize',exact:true}).click();await expect(page.getByRole('button',{name:'Done',exact:true})).toBeVisible();
    expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(1);
});

test('duplicate submits are guarded and Back aborts an authorization response before replay',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls,state}=await fixture(page);await activate(page);state.holdAuthorization=true;await enter(page);
    await page.getByRole('button',{name:'Authorize',exact:true}).evaluate(button=>{const form=(button as HTMLButtonElement).form!;form.requestSubmit();form.requestSubmit();});
    await expect.poll(()=>calls.filter(call=>call.path.endsWith('/authorize')).length).toBe(1);
    await page.getByRole('button',{name:'Back',exact:true}).click();state.releaseAuthorization();await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toHaveCount(0);await page.waitForTimeout(500);
    expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(0);
});

test('missing token fails safely and a fresh edit can retry',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls,state}=await fixture(page);state.missingToken=true;await activate(page);await enter(page);await page.getByRole('button',{name:'Authorize',exact:true}).click();await expect(page.getByRole('alert')).toContainText('failed');
    expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(0);state.missingToken=false;await enter(page);await page.getByRole('button',{name:'Authorize',exact:true}).click();await expect(page.getByRole('button',{name:'Done',exact:true})).toBeVisible();
});

test('route cancellation and unmount release the approval lock without replay',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await activate(page);await page.evaluate(()=>{(window as any).cancelApproval();(window as any).closeSend();});
    await page.getByRole('button',{name:'Open send',exact:true}).click();await page.waitForTimeout(600);await activate(page);await enter(page);await page.getByRole('button',{name:'Authorize',exact:true}).click();await expect(page.getByRole('button',{name:'Done',exact:true})).toBeVisible();
    expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(1);
});

test('fast and slow drag follows the finger, snaps back, and uses the final release coordinate',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await review(page);
    const slider=page.getByRole('button',{name:'Slide to send',exact:true});const box=(await slider.boundingBox())!;const start=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(start,y);await page.mouse.down();
    for(const distance of [35,70,110,145]) {await page.mouse.move(start+distance,y);const translate=await slider.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41);expect(Math.abs(translate-distance)).toBeLessThan(1);await page.waitForTimeout(45);}
    await page.mouse.up();await expect(slider).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');expect(calls.filter(c=>c.path==='/api/user/wallet/send')).toHaveLength(0);
    await page.mouse.move(start,y);await page.mouse.down();await page.mouse.move(start+30,y);
    await slider.evaluate((el,{start,y})=>el.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:start+(el.parentElement!.clientWidth-58),clientY:y,bubbles:true})),{start,y});
    await page.mouse.up();await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();expect(calls.filter(c=>c.path==='/api/user/wallet/send')).toHaveLength(1);
});

test('reduced motion completes the inline authorization without a second dialog',async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await activate(page);await corners(page);await enter(page);await page.getByRole('button',{name:'Authorize',exact:true}).click();await expect(page.getByRole('button',{name:'Done',exact:true})).toBeVisible();await corners(page);expect(calls.filter(c=>c.path.endsWith('/authorize'))).toHaveLength(1);
});


test('PIN handoff uses the same card with bounded motion blur and blocks input during transition',async({page})=>{
    await page.setViewportSize({width:390,height:844});await fixture(page);await review(page);
    await page.evaluate(()=>{
        const original=Element.prototype.animate;(window as any).handoff=[];
        Element.prototype.animate=function(frames,options){
            if(this.id==='sheet-page-content'||this.id==='sheet-card') {
                const element=this as HTMLElement;const sheet=document.querySelector('#sheet-card')!;const style=getComputedStyle(sheet);
                (window as any).handoff.push({id:this.id,frames,duration:typeof options==='number'?options:options?.duration,inert:element.hasAttribute('inert'),corners:[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius]});
            }
            return original.call(this,frames,options);
        };
    });
    await activate(page);
    const frames=await page.evaluate(()=>(window as any).handoff as {id:string;frames:unknown;duration:number;inert:boolean;corners:string[]}[]);
    expect(frames.filter(frame=>frame.id==='sheet-page-content')).toHaveLength(2);
    for(const frame of frames){expect(frame.duration).toBeLessThanOrEqual(160);expect(frame.corners).toEqual(['28px','28px','0px','0px']);}
    expect(JSON.stringify(frames.filter(frame=>frame.id==='sheet-page-content'))).toContain('blur(4px)');
    expect(frames.find(frame=>frame.id==='sheet-page-content'&&frame.duration===160)?.inert).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(1);await corners(page);
});

test('unconfigured PIN keeps setup inside Send and cannot replay the original transfer',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page,false);await review(page);
    await page.getByRole('button',{name:'Slide to send',exact:true}).focus();await page.keyboard.press('Enter');
    await expect(page.getByRole('heading',{name:'Set up your transaction PIN',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);await corners(page);
    await page.getByLabel('Back',{exact:true}).click();await expect(page.getByRole('button',{name:'Slide to send',exact:true})).toBeEnabled();expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
});


test('desktop PIN handoff uses bounded fade, slide and motion blur',async({page})=>{
    await page.setViewportSize({width:1280,height:844});await fixture(page);
    await page.evaluate(()=>{
        const original=Element.prototype.animate;(window as any).desktopHandoff=[];
        Element.prototype.animate=function(frames,options){
            if(this.hasAttribute('data-send-screen'))(window as any).desktopHandoff.push({frames,duration:typeof options==='number'?options:options?.duration});
            return original.call(this,frames,options);
        };
    });
    await activate(page);await page.getByRole('button',{name:'Authorize',exact:true}).waitFor({state:'visible'});
    await expect.poll(()=>page.locator('[data-send-screen]').evaluate(element=>element.getAnimations().every(animation=>animation.playState==='finished'))).toBe(true);
    const frames=await page.evaluate(()=>(window as any).desktopHandoff as {duration:number;frames:unknown}[]);
    expect(frames.length).toBeGreaterThan(0);for(const frame of frames){expect(frame.duration).toBeLessThanOrEqual(160);}
    expect(JSON.stringify(frames)).toContain('blur(4px)');
    await expect(page.getByRole('dialog')).toHaveCount(1);
});
