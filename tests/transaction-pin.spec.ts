import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

let stylesheet = "";
test.beforeAll(async () => {
    const source = path.resolve("src/app/globals.css");
    stylesheet = (await postcss([tailwindcss({ base: process.cwd() })]).process(fs.readFileSync(source, "utf8"), { from: source })).css;
});

const merchantNavigationCleanup = fs.readFileSync(path.resolve("src/app/dashboard/page.tsx"), "utf8")
    .match(/useLayoutEffect\(\(\) => \(\) => cancelTransactionPinPrompt\(\), \[activeTab, subTab, merchantSubView\]\);/)?.[0];
if (!merchantNavigationCleanup) throw new Error("Merchant state navigation must cancel pending approvals.");

const script = buildSync({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ensureTransactionPinSetup,fetchWithTransactionPin} from './src/lib/client/transactionPin';
import TransactionPinSettings from './src/components/TransactionPinSettings';
import TransactionPinCard from './src/components/dashboard/TransactionPinCard';
import TransactionPinPage from './src/app/dashboard/transaction-pin/page';
import TransactionPinLifecycle from './src/components/TransactionPinLifecycle';
import {PathnameContext,SearchParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {cancelTransactionPinPrompt} from './src/components/TransactionPinPrompt';
let controller;
window.send = () => { controller=new AbortController(); return fetchWithTransactionPin('/api/user/wallet/send',{method:'POST',signal:controller.signal,body:JSON.stringify({recipients:[{receiverAddress:'alice',amountUsdc:'2'},{receiverAddress:'bob',amountUsdc:'3'}]})}).then(async r=>document.querySelector('#result').textContent=JSON.stringify(await r.json())).catch(e=>document.querySelector('#result').textContent=e.name); };
window.abort = () => controller.abort();
window.cancelRoute = cancelTransactionPinPrompt;
window.sendWithoutSignal = () => fetchWithTransactionPin('/api/user/wallet/send',{method:'POST',body:'{}'}).then(async r=>document.querySelector('#result').textContent=JSON.stringify(await r.json())).catch(e=>document.querySelector('#result').textContent=e.name);
function RouteHarness() {
    const [route,setRoute]=React.useState('/user');
    window.navigatePinRoute=setRoute;
    const url=new URL(route,'http://localhost:9876');
    return React.createElement(PathnameContext.Provider,{value:url.pathname},React.createElement(SearchParamsContext.Provider,{value:url.searchParams},React.createElement(TransactionPinLifecycle),React.createElement('div',{'data-pin-route':true},route)));
}
window.routeLifecycle = () => createRoot(document.querySelector('#root')).render(React.createElement(RouteHarness));
function MerchantNavigationHarness() {
    const [{activeTab,subTab,merchantSubView},setView]=React.useState({activeTab:'payment-links',subTab:'subscriptions',merchantSubView:'menu'});
    window.navigateMerchantView=patch=>setView(current=>({...current,...patch}));
    const {useLayoutEffect}=React;
    ${merchantNavigationCleanup}
    return React.createElement('div',{'data-merchant-view':true},[activeTab,subTab,merchantSubView].join('/'));
}
window.merchantLifecycle = () => createRoot(document.querySelector('#root')).render(React.createElement(MerchantNavigationHarness));
window.settings = () => createRoot(document.querySelector('#root')).render(React.createElement(TransactionPinSettings));
window.pinCard = () => createRoot(document.querySelector('#root')).render(React.createElement(TransactionPinCard));
window.embeddedSettings = () => createRoot(document.querySelector('#root')).render(React.createElement(TransactionPinSettings, {embedded:true,onBack:()=>{document.querySelector('#result').textContent='security';}}));
window.pinRoute = () => createRoot(document.querySelector('#root')).render(React.createElement(TransactionPinPage));
window.signatureRequests = 0;
window.browserTransaction = () => ensureTransactionPinSetup().then(() => { window.signatureRequests++; }).catch(e => document.querySelector('#result').textContent=e.name);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } }).outputFiles[0].text;

async function fixture(page: import('@playwright/test').Page, configured = true) {
    const calls: { path: string; headers: Record<string, string>; body: unknown }[] = [];
    const state = { incorrect: false, locked: false, configured, required: true };
    await page.route('**/*', async route => {
        const request = route.request(); const path = new URL(request.url()).pathname;
        const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (!path.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div><div id="result"></div></body></html>' });
        calls.push({ path, headers: request.headers(), body: request.postData() ? request.postDataJSON() : null });
        if (path === '/api/user/wallet/send') return request.headers()['x-transaction-pin-token'] ? json({ success: true, status: 'pending', circleTxId: 'pending-1' }, 202) : json({ code: 'TRANSACTION_PIN_REQUIRED', challengeId: 'challenge', configured: state.configured }, 428);
        if (path.endsWith('/authorize')) return state.locked ? json({error:'PIN locked. Reset securely or retry after lock expires.'}, 423) : state.incorrect ? json({error:'Incorrect transaction PIN.'}, 403) : json({token:'opaque-token'});
        if (path === '/api/user/transaction-pin') return json({configured: state.configured, required: state.required});
        if (path === '/api/auth/session') return json({loggedIn:true,role:'USER',email:'user@example.com'});
        if (path === '/api/auth/otp/send') return json({challengeId:'email-challenge',retryAfterSeconds:60});
        if (path === '/api/auth/otp/verify') return json({stepUpToken:'fresh-otp-token'});
        return json({success:true,configured:true});
    });
    await page.goto('http://localhost:9876'); await page.addStyleTag({content:stylesheet}); await page.addScriptTag({content:script});
    return {calls,state};
}

test('embedded PIN settings keep the dashboard shell and return to Security', async ({page}, testInfo) => {
    await page.setViewportSize({width:390,height:844});
    await fixture(page, false);
    await page.evaluate(() => (window as unknown as {embeddedSettings:()=>void}).embeddedSettings());
    await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Send verification code',exact:true})).toBeEnabled();
    await expect(page.locator('main')).toHaveCount(0);
    await expect(page.getByRole('link',{name:'Back to dashboard'})).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath('embedded-pin-settings.png')});
    await page.getByRole('button',{name:'Back to Security'}).click();
    await expect(page.locator('#result')).toHaveText('security');
});

test('legacy PIN route opens the user dashboard Security flow', async ({page}) => {
    await fixture(page);
    await page.evaluate(() => (window as unknown as {pinRoute:()=>void}).pinRoute());
    await expect(page).toHaveURL('http://localhost:9876/user?tab=dns&subview=transaction-pin');
});

test('legacy PIN route preserves enterprise PIN settings', async ({page}) => {
    await fixture(page);
    await page.route('**/api/auth/session', route=>route.fulfill({json:{loggedIn:true,role:'ENTERPRISE',email:'merchant@example.com'}}));
    await page.evaluate(() => (window as unknown as {pinRoute:()=>void}).pinRoute());
    await expect(page.getByRole('heading',{name:'Transaction PIN',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Back to dashboard'})).toHaveAttribute('href','/merchant');
});

test('mobile keypad masks digits, limits length, deletes and shows rejection/success feedback', async ({page}, testInfo) => {
    await page.setViewportSize({width:390,height:844});
    const {calls,state}=await fixture(page);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    const input=page.getByLabel('Six-digit transaction PIN',{exact:true});
    const keypad=page.getByRole('group',{name:'PIN keypad'});
    const slots=page.locator('[data-pin-slot]');
    await expect(input).toHaveAttribute('inputmode','none');
    await expect(input).toHaveAttribute('readonly','');
    await expect(slots).toHaveCount(6);
    for (const digit of '482619') await keypad.getByRole('button',{name:digit,exact:true}).click();
    await expect(input).toHaveValue('482619');
    await expect(keypad.getByRole('button',{name:'1',exact:true})).toBeDisabled();
    await expect(slots.first()).toHaveText('');
    await keypad.getByRole('button',{name:'Delete last digit'}).click();
    await expect(input).toHaveValue('48261');
    await keypad.getByRole('button',{name:'9',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath('pin-mobile-filled.png')});
    state.incorrect=true;
    await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect');
    await expect(input).toHaveValue('');
    await expect(page.locator('[data-pin-feedback]')).toHaveAttribute('data-pin-feedback','error');
    await expect(page.locator('[data-pin-field]')).toHaveCSS('border-top-color','oklch(0.637 0.237 25.331)');
    for (const slot of await slots.all()) await expect(slot).toHaveCSS('border-top-width','0px');
    await page.screenshot({path:testInfo.outputPath('pin-mobile-error.png')});
    state.incorrect=false;
    for (const digit of '482619') await keypad.getByRole('button',{name:digit,exact:true}).click();
    await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.getByRole('status')).toHaveText('PIN verified');
    await expect(page.locator('[data-pin-feedback]')).toHaveAttribute('data-pin-feedback','success');
    await expect(keypad.getByRole('button',{name:'Delete last digit'})).toBeDisabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.filter(c=>c.path.endsWith('/authorize'))).toHaveLength(2);
    expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(2);
});

for (const reduced of [false, true]) test(`PIN touch feedback ${reduced ? 'respects reduced motion' : 'pulses only for accepted key presses'}`, async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
    await fixture(page);
    await page.evaluate(() => {
        const pulses:number[]=[];
        (window as unknown as {pinFeedbackPulses:number[]}).pinFeedbackPulses=pulses;
        Object.defineProperty(navigator,'vibrate',{configurable:true,value:(duration:number)=>{pulses.push(duration);return true;}});
        void (window as unknown as {send:()=>Promise<void>}).send();
    });
    const keypad=page.getByRole('group',{name:'PIN keypad',exact:true});
    await expect(keypad.getByRole('button',{name:'Delete last digit'})).toBeDisabled();
    for (const digit of '482619') await keypad.getByRole('button',{name:digit,exact:true}).click();
    await expect(keypad.getByRole('button',{name:'1',exact:true})).toBeDisabled();
    await keypad.getByRole('button',{name:'Delete last digit'}).click();
    expect(await page.evaluate(()=>(window as unknown as {pinFeedbackPulses:number[]}).pinFeedbackPulses)).toEqual(reduced?[]:Array(7).fill(10));
    await page.evaluate(()=>Object.defineProperty(navigator,'vibrate',{configurable:true,value:()=>{throw new Error('Device feedback unavailable');}}));
    await keypad.getByRole('button',{name:'9',exact:true}).click();
    await expect(page.getByLabel('Six-digit transaction PIN',{exact:true})).toHaveValue('482619');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
});

test('cancellation during green confirmation prevents the authorized retry', async ({page}) => {
    const {calls}=await fixture(page);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    await page.getByLabel('Six-digit transaction PIN',{exact:true}).fill('482619');
    await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.getByRole('status')).toHaveText('PIN verified');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.locator('#result')).toHaveText('AbortError');
    await page.waitForTimeout(450);
    expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(1);
});

for (const action of ['enroll','change','reset'] as const) test(`mobile ${action} uses the same masked keypad throughout setup`, async ({page},testInfo) => {
    await page.setViewportSize({width:390,height:844});
    const {calls}=await fixture(page,action !== 'enroll');
    await page.evaluate(() => (window as unknown as {settings:()=>void}).settings());
    if (action === 'reset') await page.getByRole('button',{name:'Forgot PIN',exact:true}).click();
    await page.getByRole('button',{name:'Send verification code',exact:true}).click();
    const fields=action === 'change' ? [['Email code','112233'],['Current PIN','731492'],['New PIN','482619'],['Confirm new PIN','482619']] : [['Email code','112233'],['New PIN','482619'],['Confirm new PIN','482619']];
    for (const [index,[label,value]] of fields.entries()) {
        await expect(page.getByText(`Step ${index+1} of ${fields.length}`,{exact:true})).toBeVisible();
        const input=page.getByLabel(label,{exact:true});
        await expect(input).toHaveAttribute('type','password');
        await expect(input).toHaveAttribute('inputmode','none');
        await expect(page.locator('[data-pin-slot]')).toHaveCount(6);
        const keypad=page.getByRole('group',{name:'PIN keypad',exact:true});
        await expect(keypad).toHaveCount(1);
        for (const digit of value) await keypad.getByRole('button',{name:digit,exact:true}).click();
        await expect(input).toHaveValue(value);
        await expect(page.locator('[data-pin-slot]').first()).toHaveText('');
        if(index===1) {
            await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport();
            await page.getByRole('button',{name:'Back',exact:true}).click();
            await expect(page.getByLabel(fields[0][0],{exact:true})).toHaveValue(fields[0][1]);
            await page.getByRole('button',{name:'Continue',exact:true}).click();
            await expect(page.getByLabel(label,{exact:true})).toHaveValue(value);
            await page.screenshot({path:testInfo.outputPath(`mobile-${action}.png`)});
        }
        if(index < fields.length-1) await page.getByRole('button',{name:'Continue',exact:true}).click();
    }
    expect(calls.filter(call=>call.path.endsWith('/otp/verify'))).toHaveLength(0);
    await page.getByRole('button',{name:'Verify and save PIN',exact:true}).click();
    await expect(page.locator('[data-pin-feedback="success"]')).toHaveCount(1);
    await expect(page.getByRole('status')).toContainText(action==='reset'?'reset':'saved');
    const saved=calls.find(call=>call.path.endsWith(`/${action}`))!;
    expect(saved.body).toEqual({pin:'482619',...(action==='change'?{currentPin:'731492'}:{})});
    expect(saved.headers['x-step-up-token']).toBe('fresh-otp-token');
});

test('mobile reduced motion keeps rejection feedback stationary on a small screen', async ({page}) => {
    await page.setViewportSize({width:320,height:568});
    await page.emulateMedia({reducedMotion:'reduce'});
    const {state}=await fixture(page);
    state.incorrect=true;
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    const keypad=page.getByRole('group',{name:'PIN keypad'});
    for (const digit of '482619') await keypad.getByRole('button',{name:digit,exact:true}).click();
    await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect');
    const input=page.getByLabel('Six-digit transaction PIN',{exact:true});
    expect(await input.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node.parentElement!).transform).m41)).toBe(0);
    const bounds=await page.getByRole('dialog').boundingBox();
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(320);
    expect(bounds!.height).toBeLessThanOrEqual(568);
});

test('full batch review, incorrect/locked attempts, opaque retry and pending status', async ({page}) => {
    const {calls,state}=await fixture(page);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/ph-no-capture/);
    await expect(page.getByLabel('Six-digit transaction PIN')).toHaveAttribute('type','password');
    await expect(page.getByLabel('Six-digit transaction PIN')).toHaveAttribute('data-private','true');
    await expect(dialog).toContainText('alice'); await expect(dialog).toContainText('bob');
    state.incorrect=true; await page.getByLabel('Six-digit transaction PIN').fill('123456'); await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect'); await expect(page.getByLabel('Six-digit transaction PIN')).toHaveValue('');
    state.incorrect=false; state.locked=true; await page.getByLabel('Six-digit transaction PIN').fill('123456'); await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('locked');
    state.locked=false; await page.getByLabel('Six-digit transaction PIN').fill('482619'); await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(dialog).toHaveCount(0); await expect(page.locator('#result')).toContainText('pending-1');
    const sends=calls.filter(c=>c.path.endsWith('/send')); expect(sends).toHaveLength(2); expect(sends[1].body).toEqual(sends[0].body); expect(sends[1].headers['x-transaction-operation-id']).toEqual(sends[0].headers['x-transaction-operation-id']); expect(sends[1].headers['x-transaction-pin-token']).toBe('opaque-token');
});

test('cancel and abort clear PIN dialog without retry', async ({page}) => {
    const {calls}=await fixture(page);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    await page.getByLabel('Six-digit transaction PIN').fill('123456'); await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('#result')).toHaveText('AbortError');
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    await expect(page.getByLabel('Six-digit transaction PIN')).toHaveValue('');
    await page.evaluate(() => (window as unknown as {abort:()=>void}).abort());
    await expect(page.getByRole('dialog')).toHaveCount(0); expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(2); expect(calls.filter(c=>c.path.endsWith('/authorize'))).toHaveLength(0);
});

test('unconfigured transaction requires enrollment and cannot continue', async ({page}) => {
    const {calls}=await fixture(page,false);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    await expect(page.getByRole('dialog',{name:'Set up your transaction PIN'})).toBeVisible();
    await expect(page.getByRole('link',{name:'Set up PIN'})).toHaveAttribute('href','/dashboard/transaction-pin');
    expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.locator('#result')).toHaveText('AbortError');
    expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(0);
});

test('browser wallet setup popup prevents signature requests and configured accounts can proceed',async({page})=>{
    const {state}=await fixture(page,false);
    await page.evaluate(() => { void (window as unknown as {browserTransaction:()=>Promise<void>}).browserTransaction(); });
    await expect(page.getByRole('dialog',{name:'Set up your transaction PIN'})).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as {signatureRequests:number}).signatureRequests)).toBe(0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.locator('#result')).toHaveText('AbortError');
    state.configured=true;
    await page.evaluate(() => (window as unknown as {browserTransaction:()=>Promise<void>}).browserTransaction());
    expect(await page.evaluate(() => (window as unknown as {signatureRequests:number}).signatureRequests)).toBe(1);
});

test('setup button navigates after popup cleanup without submitting the transaction',async({page})=>{
    const {calls}=await fixture(page,false);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    await page.getByRole('link',{name:'Set up PIN'}).click();
    await expect(page).toHaveURL('http://localhost:9876/dashboard/transaction-pin');
    expect(calls.filter(c=>c.path.endsWith('/send')||c.path.endsWith('/authorize'))).toHaveLength(0);
});

test('setup popup on checkout host navigates to the dashboard PIN page',async({page})=>{
    const {calls}=await fixture(page,false);
    await page.goto('https://pay.subscriptonarc.com/pay/example');
    await page.addScriptTag({content:script});
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    await expect(page.getByRole('link',{name:'Set up PIN'})).toHaveAttribute('href','https://dashboard.subscriptonarc.com/dashboard/transaction-pin');
    await page.getByRole('link',{name:'Set up PIN'}).click();
    await expect(page).toHaveURL('https://dashboard.subscriptonarc.com/dashboard/transaction-pin');
    expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(0);
});

test('route lifecycle cancellation erases entered PIN and never authorizes', async ({page}) => {
    const {calls}=await fixture(page);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    await page.getByLabel('Six-digit transaction PIN').fill('123456');
    await page.evaluate(() => (window as unknown as {cancelRoute:()=>void}).cancelRoute());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#result')).toHaveText('AbortError');
    expect(calls.filter(c=>c.path.endsWith('/authorize'))).toHaveLength(0);
});

for (const phase of ['preflight','challenge'] as const) for (const destination of ['/merchant','/user?tab=dns']) test(`${destination.includes('?')?'query':'pathname'} navigation cancels delayed ${phase} before a PIN prompt mounts`, async ({page}) => {
    const {calls}=await fixture(page);
    await page.evaluate(phase => {
        const original=window.fetch.bind(window);
        const heldPath=phase==='preflight'?'/api/user/transaction-pin':'/api/user/wallet/send';
        (window as unknown as {heldPinRequest:boolean}).heldPinRequest=false;
        window.fetch=(input,init)=>String(input)===heldPath?new Promise<Response>(resolve=>{
            (window as unknown as {heldPinRequest:boolean}).heldPinRequest=true;
            (window as unknown as {releasePinResponse:()=>void}).releasePinResponse=()=>resolve(Response.json(phase==='preflight'?{configured:true}:{code:'TRANSACTION_PIN_REQUIRED',challengeId:'stale-challenge',configured:true},{status:phase==='preflight'?200:428}));
        }):original(input,init);
        (window as unknown as {routeLifecycle:()=>void}).routeLifecycle();
    },phase);
    await expect(page.locator('[data-pin-route]')).toHaveText('/user');
    await page.evaluate(()=>{void (window as unknown as {sendWithoutSignal:()=>Promise<void>}).sendWithoutSignal();});
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {heldPinRequest:boolean}).heldPinRequest)).toBe(true);
    await page.evaluate(destination=>(window as unknown as {navigatePinRoute:(route:string)=>void}).navigatePinRoute(destination),destination);
    await expect(page.locator('[data-pin-route]')).toHaveText(destination);
    await page.evaluate(()=>(window as unknown as {releasePinResponse:()=>void}).releasePinResponse());
    await expect(page.locator('#result')).toHaveText('AbortError');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.filter(call=>call.path.endsWith('/authorize')||call.path.endsWith('/wallet/send'))).toHaveLength(0);
});

for (const phase of ['preflight','challenge'] as const) for (const patch of [
    {activeTab:'settings'}, {subTab:'commit'}, {merchantSubView:'security'},
] as Record<string,string>[]) test(`merchant state-only ${Object.keys(patch)[0]} navigation cancels delayed ${phase}`, async ({page}) => {
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const {calls}=await fixture(page);
    await page.evaluate(phase=>{
        const original=window.fetch.bind(window);
        const heldPath=phase==='preflight'?'/api/user/transaction-pin':'/api/user/wallet/send';
        (window as unknown as {heldPinRequest:boolean}).heldPinRequest=false;
        let hold=true;
        window.fetch=(input,init)=>hold&&String(input)===heldPath?new Promise<Response>(resolve=>{
            (window as unknown as {heldPinRequest:boolean}).heldPinRequest=true;
            (window as unknown as {releasePinResponse:()=>void}).releasePinResponse=()=>{hold=false;resolve(Response.json(phase==='preflight'?{configured:true}:{code:'TRANSACTION_PIN_REQUIRED',challengeId:'stale-challenge',configured:true},{status:phase==='preflight'?200:428}));};
        }):original(input,init);
        (window as unknown as {merchantLifecycle:()=>void}).merchantLifecycle();
    },phase);
    await expect(page.locator('[data-merchant-view]')).toHaveText('payment-links/subscriptions/menu');
    const unchangedUrl=page.url();
    await page.evaluate(()=>{void (window as unknown as {sendWithoutSignal:()=>Promise<void>}).sendWithoutSignal();});
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {heldPinRequest:boolean}).heldPinRequest)).toBe(true);
    await page.evaluate(patch=>(window as unknown as {navigateMerchantView:(patch:Record<string,string>)=>void}).navigateMerchantView(patch),patch);
    await expect(page.locator('[data-merchant-view]')).not.toHaveText('payment-links/subscriptions/menu');
    expect(page.url()).toBe(unchangedUrl);
    await page.evaluate(()=>(window as unknown as {releasePinResponse:()=>void}).releasePinResponse());
    await expect(page.locator('#result')).toHaveText('AbortError');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.filter(call=>call.path.endsWith('/authorize')||call.path.endsWith('/wallet/send'))).toHaveLength(0);
    // Fresh work on the destination state survives mount and ordinary rendering.
    await page.evaluate(()=>{void (window as unknown as {sendWithoutSignal:()=>Promise<void>}).sendWithoutSignal();});
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('change PIN requires current PIN and fresh action-bound OTP without introducing recovery hold', async ({page}) => {
    const {calls}=await fixture(page);
    await page.evaluate(()=>(window as unknown as {settings:()=>void}).settings());
    await page.getByRole('button',{name:'Send verification code'}).click();
    await expect(page.getByLabel('Email code')).toHaveAttribute('type','password');
    await page.getByLabel('Email code').fill('112233'); await page.getByLabel('Current PIN').fill('123456');
    await page.getByLabel('New PIN',{exact:true}).fill('482619'); await page.getByLabel('Confirm new PIN').fill('482619');
    await page.getByRole('button',{name:'Verify and save PIN'}).click();
    await expect(page.locator('[data-pin-feedback="success"]')).toHaveCount(3);
    await expect(page.getByRole('status')).toContainText('saved');
    const saved=calls.find(c=>c.path.endsWith('/change'))!; expect(saved.body).toEqual({pin:'482619',currentPin:'123456'});
    expect(saved.headers['x-step-up-token']).toBe('fresh-otp-token');
    expect(calls.find(c=>c.path.endsWith('/otp/verify'))!.body).toMatchObject({stepUp:{action:'transaction-pin:change'}});
    await expect(page.getByRole('status')).not.toContainText('24 hours');
});

for (const reset of [false,true]) test(`${reset?'reset':'enrollment'} requires exact fresh OTP and clears credentials`,async({page})=>{
    const {calls}=await fixture(page,reset);
    await page.evaluate(()=>(window as unknown as {settings:()=>void}).settings());
    if(reset) await page.getByRole('button',{name:'Forgot PIN'}).click();
    await page.getByRole('button',{name:'Send verification code'}).click();
    await page.getByLabel('Email code').fill('112233'); await page.getByLabel('New PIN',{exact:true}).fill('482619'); await page.getByLabel('Confirm new PIN').fill('482619');
    await page.getByRole('button',{name:'Verify and save PIN'}).click();
    await expect(page.getByRole('status')).toContainText(reset?'reset':'saved');
    const verify=calls.find(c=>c.path.endsWith('/otp/verify'))!; expect(verify.body).toMatchObject({purpose:'financial_step_up',stepUp:{action:`transaction-pin:${reset?'reset':'enroll'}`}});
    const saved=calls.find(c=>c.path.endsWith(reset?'/reset':'/enroll'))!; expect(saved.headers['x-step-up-token']).toBe('fresh-otp-token'); expect(saved.body).toEqual({pin:'482619'});
    await expect(page.getByLabel('New PIN',{exact:true})).toHaveCount(0);
});

for (const width of [390,1280]) test(`PIN confirmation is readable at ${width}px`, async ({page},testInfo) => {
    await page.setViewportSize({width,height:844});
    await fixture(page);
    await page.evaluate(() => { void (window as unknown as {send:()=>Promise<void>}).send(); });
    const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();
    const bounds=await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width); expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(844);
    await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport();
    await page.screenshot({path:testInfo.outputPath(`pin-${width}.png`)});
});

for (const scenario of [
    { name: "unconfigured", status: { configured: false }, label: "Not set up" },
    { name: "configured", status: { configured: true }, label: "Active" },
    { name: "locked", status: { configured: true, lockedUntil: "2099-01-01T00:00:00Z" }, label: "Locked" },
    { name: "recovery", status: { configured: true, coolingOffUntil: "2099-01-01T00:00:00Z" }, label: "Recovery hold" },
    { name: "expired hold", status: { configured: true, lockedUntil: "2020-01-01T00:00:00Z", coolingOffUntil: "2020-01-01T00:00:00Z" }, label: "Active" },
]) test(`dashboard PIN card shows actual ${scenario.name} status`, async ({ page }, testInfo) => {
    await fixture(page);
    await page.route("**/api/user/transaction-pin", route => route.fulfill({ json: scenario.status }));
    await page.evaluate(() => (window as unknown as { pinCard: () => void }).pinCard());
    await expect(page.getByRole("status")).toHaveText(scenario.label);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.getByRole("link", { name: scenario.status.configured ? "Manage PIN" : "Set up PIN" })).toHaveAttribute("href", "/dashboard/transaction-pin");
    if (scenario.name === "unconfigured") {
        await page.setViewportSize({ width: 390, height: 844 });
        const card = page.getByRole("region", { name: "Transaction PIN" });
        const bounds = await card.boundingBox();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
        await page.screenshot({ path: testInfo.outputPath("pin-card-mobile.png") });
    }
});

test("dashboard PIN status failure and malformed response never claim protection and can retry", async ({ page }) => {
    await fixture(page);
    let attempts = 0;
    await page.route("**/api/user/transaction-pin", route => {
        attempts++;
        return route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { error: "Offline" } : attempts === 2 ? { configured: "true" } : { configured: true } });
    });
    await page.evaluate(() => (window as unknown as { pinCard: () => void }).pinCard());
    await expect(page.getByRole("status")).toHaveText("Unavailable");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => attempts).toBe(2);
    await expect(page.getByRole("status")).toHaveText("Unavailable");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Active");
});

test("settings load failures offer retry and merchant return uses the actual session role", async ({ page }) => {
    await fixture(page);
    let attempts = 0;
    await page.route("**/api/user/transaction-pin", route => route.fulfill({ status: ++attempts === 1 ? 503 : 200, json: { configured: true } }));
    await page.route("**/api/auth/session", route => route.fulfill({ json: { loggedIn: true, role: "ENTERPRISE", email: "merchant@example.com" } }));
    await page.evaluate(() => (window as unknown as { settings: () => void }).settings());
    await expect(page.getByRole("alert")).toContainText("Unable to load");
    await page.getByRole("button", { name: "Retry loading PIN settings" }).click();
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/merchant");
    await expect(page.getByText("Verification email: merchant@example.com")).toBeVisible();
});

test("unverified email never exposes the enrollment form", async ({ page }) => {
    await fixture(page, false);
    await page.route("**/api/auth/session", route => route.fulfill({ json: { loggedIn: true, role: "USER", email: null } }));
    await page.evaluate(() => (window as unknown as { settings: () => void }).settings());
    await expect(page.getByRole("alert")).toContainText("Link and verify an email");
    await expect(page.getByRole("button", { name: "Send verification code" })).toHaveCount(0);
});

test("external wallet settings need neither PIN enrollment nor an email", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { state, calls } = await fixture(page, false);
    state.required = false;
    await page.route("**/api/auth/session", route => route.fulfill({ json: { loggedIn: true, role: "USER", email: null } }));
    await page.evaluate(() => (window as unknown as { settings: () => void }).settings());
    await expect(page.getByRole("heading", { name: "Your wallet handles approvals" })).toBeVisible();
    await expect(page.getByText("External wallets do not need a transaction PIN.", { exact: false })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send verification code" })).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
    expect(calls.filter(call => call.path.includes("/otp/"))).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("external-wallet-settings.png") });
});

test("external wallet card describes wallet approvals without setup controls", async ({ page }) => {
    const { state } = await fixture(page, false);
    state.required = false;
    await page.evaluate(() => (window as unknown as { pinCard: () => void }).pinCard());
    await expect(page.getByRole("status")).toHaveText("Wallet approvals");
    await expect(page.getByText("External wallets do not need a transaction PIN.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: /Set up PIN|Manage PIN/ })).toHaveCount(0);
});

test("anonymous session never exposes PIN settings", async ({ page }) => {
    await fixture(page, false);
    await page.route("**/api/auth/session", route => route.fulfill({ json: { loggedIn: false } }));
    await page.evaluate(() => (window as unknown as { settings: () => void }).settings());
    await expect(page.getByRole("alert")).toContainText("Unable to load PIN settings");
    await expect(page.getByRole("button", { name: "Send verification code" })).toHaveCount(0);
});

test("weak PIN validation happens before consuming a fresh OTP", async ({ page }) => {
    const { calls } = await fixture(page, false);
    await page.evaluate(() => (window as unknown as { settings: () => void }).settings());
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Email code").fill("112233");
    await page.getByLabel("New PIN", { exact: true }).fill("123456");
    await page.getByLabel("Confirm new PIN").fill("123456");
    await page.getByRole("button", { name: "Verify and save PIN" }).click();
    await expect(page.getByRole("status")).toContainText("without a repeated or sequential pattern");
    await expect(page.locator('[data-pin-feedback="error"]')).toHaveCount(2);
    expect(calls.filter(call => call.path.endsWith("/otp/verify"))).toHaveLength(0);
});

test("failed current PIN clears consumed OTP challenge and all credentials before retry", async ({ page }) => {
    await fixture(page);
    await page.clock.install();
    await page.route("**/api/user/transaction-pin/change", route => route.fulfill({ status: 403, json: { error: "Current PIN verification failed." } }));
    await page.evaluate(() => (window as unknown as { settings: () => void }).settings());
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Email code").fill("112233");
    await page.getByLabel("Current PIN").fill("731492");
    await page.getByLabel("New PIN", { exact: true }).fill("482619");
    await page.getByLabel("Confirm new PIN").fill("482619");
    await page.getByRole("button", { name: "Verify and save PIN" }).click();
    await expect(page.locator('[data-pin-feedback="error"]')).toHaveCount(3);
    await expect(page.getByRole("status")).toContainText("Send a fresh verification code");
    await expect(page.getByLabel("Email code")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Request another code in/ })).toBeDisabled();
    await page.clock.fastForward(61_000);
    await page.getByRole("button", { name: "Send verification code" }).click();
    await expect(page.getByLabel("Email code")).toHaveValue("");
    await expect(page.getByLabel("Current PIN")).toHaveValue("");
    await expect(page.getByLabel("New PIN", { exact: true })).toHaveValue("");
});

test("missing OTP proof cannot submit a PIN update", async ({ page }) => {
    const { calls } = await fixture(page, false);
    await page.route("**/api/auth/otp/verify", route => route.fulfill({ json: {} }));
    await page.evaluate(() => (window as unknown as { settings: () => void }).settings());
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Email code").fill("112233");
    await page.getByLabel("New PIN", { exact: true }).fill("482619");
    await page.getByLabel("Confirm new PIN").fill("482619");
    await page.getByRole("button", { name: "Verify and save PIN" }).click();
    await expect(page.getByRole("status")).toContainText("Email verification did not complete");
    expect(calls.filter(call => call.path.endsWith("/enroll"))).toHaveLength(0);
});

test("stalled status fetch times out and releases loading with retry", async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        AbortSignal.timeout = milliseconds => timeout(milliseconds === 15_000 ? 50 : milliseconds);
        const fetch = window.fetch.bind(window);
        window.fetch = (input, init) => String(input) === "/api/user/transaction-pin" ? new Promise((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        }) : fetch(input, init);
        (window as unknown as { settings: () => void }).settings();
    });
    await expect(page.getByRole("alert")).toContainText("Unable to load PIN settings");
    await expect(page.getByRole("button", { name: "Retry loading PIN settings" })).toBeEnabled();
});

test("timed-out enrollment rechecks committed status before offering another update", async ({ page }) => {
    await fixture(page, false);
    let committed = false;
    await page.route("**/api/user/transaction-pin", route => route.fulfill({ json: { configured: committed } }));
    await page.evaluate(() => {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        AbortSignal.timeout = milliseconds => timeout(milliseconds === 20_000 ? 200 : milliseconds);
        const fetch = window.fetch.bind(window);
        window.fetch = (input, init) => String(input).endsWith("/enroll") ? new Promise((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        }) : fetch(input, init);
        (window as unknown as { settings: () => void }).settings();
    });
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Email code").fill("112233");
    await page.getByLabel("New PIN", { exact: true }).fill("482619");
    await page.getByLabel("Confirm new PIN").fill("482619");
    committed = true;
    await page.getByRole("button", { name: "Verify and save PIN" }).click();
    await expect(page.getByRole("status")).toContainText("Send a fresh verification code");
    await expect(page.getByRole("button", { name: "Change PIN", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Request another code in/ })).toBeDisabled();
    await expect(page.getByLabel("Email code")).toHaveCount(0);
});

test("PIN resend cooldown counts down and survives changing the PIN action", async ({ page }) => {
    const {calls} = await fixture(page);
    await page.clock.install();
    await page.evaluate(() => (window as unknown as {settings:()=>void}).settings());
    await page.getByRole('button',{name:'Send verification code',exact:true}).click();
    await expect(page.getByRole('button',{name:'Request another code in 60s'})).toBeDisabled();
    await page.getByRole('button',{name:'Forgot PIN',exact:true}).click();
    await expect(page.getByRole('button',{name:/Request another code in/})).toBeDisabled();
    await page.clock.fastForward(61_000);
    await page.getByRole('button',{name:'Send verification code',exact:true}).click();
    expect(calls.filter(call=>call.path==='/api/auth/otp/send')).toHaveLength(2);
});

test("server resend limit keeps the existing code and uses Retry-After", async ({ page }) => {
    await fixture(page, false);
    await page.clock.install();
    await page.evaluate(() => (window as unknown as {settings:()=>void}).settings());
    await page.getByRole('button',{name:'Send verification code',exact:true}).click();
    await page.getByLabel('Email code').fill('112233');
    await page.clock.fastForward(61_000);
    await page.route('**/api/auth/otp/send',route=>route.fulfill({status:429,headers:{'Retry-After':'42'},json:{error:'Please wait before requesting a fresh code.'}}));
    await page.getByRole('button',{name:'Send a fresh code',exact:true}).click();
    await expect(page.getByRole('button',{name:'Request another code in 42s'})).toBeDisabled();
    await expect(page.getByLabel('Email code')).toHaveValue('112233');
    await page.clock.fastForward(43_000);
    await expect(page.getByRole('button',{name:'Send a fresh code',exact:true})).toBeEnabled();
});
