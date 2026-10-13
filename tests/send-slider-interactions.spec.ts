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
async function fixture(page: Page, holdStatus = false) {
    const calls: Call[] = [];
    const state = { missingToken: false, holdAuthorization: false, holdSend: false, holdStatus, configured: true, releaseStatus: () => {}, releaseAuthorization: () => {}, releaseSend: () => {} };
    await page.route("**/*", async route => {
        const request=route.request(); const url=new URL(request.url());
        const asset=path.resolve('public',url.pathname.slice(1));
        if(asset.startsWith(path.resolve('public')+path.sep)&&fs.existsSync(asset)&&fs.statSync(asset).isFile()) return route.fulfill({path:asset});
        if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><body style="margin:0"><div id="root"></div></body></html>'});
        calls.push({path:url.pathname,body:request.postData()?request.postDataJSON():null,headers:request.headers()});
        if(url.pathname==='/api/user/transaction-pin'){if(state.holdStatus)await new Promise<void>(resolve=>state.releaseStatus=resolve);return route.fulfill({json:{configured:state.configured,required:true}});}
        if(url.pathname==='/api/user/wallet/send') {
            if(!request.headers()['x-transaction-pin-token'])return route.fulfill({status:428,json:{code:'TRANSACTION_PIN_REQUIRED',challengeId:'challenge-1',configured:true}});
            if(state.holdSend) await new Promise<void>(resolve=>state.releaseSend=resolve);
            return route.fulfill({json:{success:true,txHash:'0xabc',status:'confirmed'}});
        }
        if(url.pathname.endsWith('/authorize')) {
            if(state.holdAuthorization) await new Promise<void>(resolve=>state.releaseAuthorization=resolve);
            if(request.postDataJSON().pin!=='123456') return route.fulfill({status:403,json:{error:'Incorrect transaction PIN.'}});
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

async function pointerStart(page:Page) {
    const slider=page.getByRole('button',{name:'Slide to send',exact:true});const box=(await slider.boundingBox())!;const track=(await slider.locator('xpath=..').boundingBox())!;
    const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();return {slider,x,y,max:track.width-58};
}
async function position(page:Page) {return page.getByRole('button',{name:'Slide to send',exact:true}).evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).m41);}

test('regrabbing a returning thumb preserves its finger offset without jumping',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await review(page);const {slider,x,y}=await pointerStart(page);
    await page.mouse.move(x+140,y);await page.mouse.up();await page.waitForTimeout(35);
    await slider.evaluate(element=>element.addEventListener('pointerdown',()=>{(window as any).grabPosition=new DOMMatrix(getComputedStyle(element).transform).m41;},{capture:true}));
    expect(await position(page)).toBeGreaterThan(0);
    const thumb=(await slider.boundingBox())!;const grab=thumb.x+thumb.width/2;await page.mouse.move(grab,y);await page.mouse.down();await page.mouse.move(grab+15,y);
    expect(Math.abs(await position(page)-(await page.evaluate(()=>(window as any).grabPosition)+15))).toBeLessThan(3);await page.mouse.up();
    await expect.poll(()=>position(page)).toBe(0);expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
});

test('secondary pointers cannot hijack or complete the primary drag',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await review(page);const {slider,x,y}=await pointerStart(page);await page.mouse.move(x+40,y);
    await slider.evaluate((element,{x,y})=>{
        for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])element.dispatchEvent(new PointerEvent(type,{pointerId:7,isPrimary:false,pointerType:'touch',button:0,clientX:x+1000,clientY:y,bubbles:true}));
    },{x,y});
    expect(Math.abs(await position(page)-40)).toBeLessThan(1);expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
    await page.mouse.move(x+80,y);expect(Math.abs(await position(page)-80)).toBeLessThan(1);await page.mouse.up();await expect.poll(()=>position(page)).toBe(0);
});

test('lost pointer capture returns the thumb and leaves a fresh drag usable',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await review(page);const {slider,x,y}=await pointerStart(page);await page.mouse.move(x+120,y);
    await slider.evaluate(element=>(element as HTMLElement).releasePointerCapture(1));await page.mouse.move(x+120,y);await page.mouse.up();await expect.poll(()=>position(page)).toBe(0);
    const again=await pointerStart(page);await page.mouse.move(again.x+35,again.y);expect(Math.abs(await position(page)-35)).toBeLessThan(1);await page.mouse.up();expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
});

test('pointer cancel never sends and suppresses an unrelated subsequent release',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await review(page);const {slider,x,y,max}=await pointerStart(page);await page.mouse.move(x+max,y);
    await slider.evaluate(element=>element.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,isPrimary:true,pointerType:'mouse',bubbles:true})));await page.mouse.up();await expect.poll(()=>position(page)).toBe(0);expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
});

test('delayed PIN preflight immediately shows visible pending feedback and prevents another activation',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls,state}=await fixture(page,true);await review(page);const {slider,x,y,max}=await pointerStart(page);await page.mouse.move(x+max,y);await page.mouse.up();
    await expect(page.getByRole('status',{name:'Preparing transfer'})).toHaveText('Preparing…');
    await expect(slider).toBeDisabled();await page.waitForTimeout(400);expect(calls.filter(call=>call.path==='/api/user/transaction-pin')).toHaveLength(1);
    state.releaseStatus();await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('PIN height morph begins at the visible review height instead of jumping to the new layout',async({page},info)=>{
    await page.setViewportSize({width:390,height:844});await fixture(page);await review(page);
    const before=await page.getByTestId('send-sheet').evaluate(element=>element.getBoundingClientRect().height);
    await page.evaluate(()=>{const original=Element.prototype.animate;(window as any).heights=[];Element.prototype.animate=function(frames,options){if(this.id==='sheet-card'&&Array.isArray(frames)&&frames[0]?.height){const rect=this.getBoundingClientRect();(window as any).heights.push({actual:rect.height,start:parseFloat(String(frames[0].height)),bottom:rect.bottom});}return original.call(this,frames,options);};});
    const {x,y,max}=await pointerStart(page);await page.mouse.move(x+max,y);await page.mouse.up();await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();await expect(page.locator('#sheet-page-content')).not.toHaveAttribute('inert');
    const heights=await page.evaluate(()=>(window as any).heights as {actual:number;start:number;bottom:number}[]);expect(heights.length).toBeGreaterThan(0);expect(Math.abs(heights[0].actual-before)).toBeLessThan(1);expect(Math.abs(heights[0].actual-heights[0].start)).toBeLessThan(1);expect(heights[0].bottom).toBe(844);
    await page.screenshot({path:info.outputPath('pin-handoff.png')});
});

test('scrolled short review opens PIN at its own top and survives navigation mid-transition',async({page})=>{
    await page.setViewportSize({width:320,height:400});const {calls}=await fixture(page);await review(page);expect(await page.getByTestId('send-sheet').evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    const {x,y,max}=await pointerStart(page);await page.mouse.move(x+max,y);await page.mouse.up();await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();
    await expect.poll(()=>page.getByTestId('send-sheet').evaluate(element=>element.scrollTop)).toBe(0);
    await page.evaluate(()=>{(window as any).cancelApproval();(window as any).closeSend();});await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls.filter(call=>call.headers['x-transaction-pin-token'])).toHaveLength(0);
    await page.getByRole('button',{name:'Open send',exact:true}).click();await expect(page.getByTestId('send-review')).toBeEnabled();
});


test('trusted touch drag keeps primary ownership when a second finger touches the thumb',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls}=await fixture(page);await review(page);
    const slider=page.getByRole('button',{name:'Slide to send',exact:true});const box=(await slider.boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;
    const session=await page.context().newCDPSession(page);
    const send=(type:"touchStart" | "touchMove" | "touchEnd",touchPoints:{id:number;x:number;y:number}[])=>session.send('Input.dispatchTouchEvent',{type,touchPoints});
    await send('touchStart',[{id:1,x,y}]);await send('touchMove',[{id:1,x:x+80,y}]);expect(Math.abs(await position(page)-80)).toBeLessThan(1);
    await send('touchStart',[{id:1,x:x+80,y},{id:2,x:x+81,y}]);await send('touchMove',[{id:1,x:x+80,y},{id:2,x:x+230,y}]);expect(Math.abs(await position(page)-80)).toBeLessThan(1);
    await send('touchMove',[{id:1,x:x+120,y},{id:2,x:x+230,y}]);await expect.poll(async()=>Math.abs(await position(page)-120)).toBeLessThan(1);await send('touchEnd',[]);
    await expect.poll(()=>position(page)).toBe(0);expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(0);
});

test('trusted full touch swipe commits once and remains pending until the real challenge arrives',async({page})=>{
    await page.setViewportSize({width:390,height:844});const {calls,state}=await fixture(page,true);await review(page);
    const slider=page.getByRole('button',{name:'Slide to send',exact:true});const box=(await slider.boundingBox())!,track=(await slider.locator('xpath=..').boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;
    const session=await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x+track.width-58,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.getByRole('status',{name:'Preparing transfer'})).toHaveText('Preparing…');await expect(slider).toBeDisabled();expect(calls.filter(call=>call.path==='/api/user/transaction-pin')).toHaveLength(1);
    state.releaseStatus();await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();expect(calls.filter(call=>call.path==='/api/user/wallet/send')).toHaveLength(1);
});
