import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { dashboardStyles } from "./fixtures/dashboard-render";

let script:string; let css:string;
test.beforeAll(async()=>{
    const [bundle,styles]=await Promise.all([
        build({stdin:{contents:`
import React from 'react'; import {createRoot} from 'react-dom/client';
import MobileFloatingNav from './src/components/dashboard/MobileFloatingNav';
import SendSingleModal from './src/components/SendSingleModal'; import DepositModal from './src/components/DepositModal';
import ConfirmModal from './src/components/ConfirmModal'; import {Home,Shield,Link2,Layers} from './src/components/icons';
const tabs=[{id:'home',label:'Home',icon:Home},{id:'commit',label:'Commit',icon:Shield},{id:'links',label:'Links',icon:Link2},{id:'batch',label:'Batch',icon:Layers}];
function Fixture(){const [send,setSend]=React.useState(false);const [deposit,setDeposit]=React.useState(false);const [dialog,setDialog]=React.useState(false);
return <div className="user-dashboard-redesign" style={{height:'100dvh',background:'#FFFFF0'}}>
<div className="user-dashboard-content" style={{height:'100dvh',overflow:'auto'}}><div style={{height:1600}}>
<button onClick={()=>setSend(true)}>Open send</button><button onClick={()=>setDeposit(true)}>Open deposit</button><button onClick={()=>setDialog(true)}>Open dialog</button>
</div></div><MobileFloatingNav tabs={tabs} activeTab="home" onSelectTab={()=>{}} isLocked={send||deposit}/>
<SendSingleModal open={send} onClose={()=>setSend(false)} onSubmit={async()=>{}} getQuote={async()=>{}} recipient="" onRecipientChange={()=>{}} amount="" onAmountChange={()=>{}} resolving={false} resolved={null} selfSend={false} loading={false} status={null} walletBalance={100} onScanQr={()=>{}} onGoToBatch={()=>{}}/>
<DepositModal isOpen={deposit} onClose={()=>setDeposit(false)} depositAddress="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" onSuccess={()=>{}}/>
<ConfirmModal open={dialog} onCancel={()=>setDialog(false)} onConfirm={()=>setDialog(false)} title="Confirm action" description="Review this action"/>
</div>}; createRoot(document.getElementById('root')).render(<Fixture/>);
`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@/lib/wagmi":path.resolve("tests/fixtures/deposit-chain.ts")},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}}),
        dashboardStyles(),
    ]); script=bundle.outputFiles[0].text;css=styles;
});

async function fixture(page:Page){
    await page.route('**/*',route=>{
        const url=new URL(route.request().url());const asset=path.resolve('public',url.pathname.slice(1));
        if(asset.startsWith(path.resolve('public')+path.sep)&&fs.existsSync(asset)&&fs.statSync(asset).isFile())return route.fulfill({path:asset});
        if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,loggedIn:true,configured:true,required:true,chains:[],deposits:[]}});
        return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><body style="margin:0"><div id="root"></div></body></html>'});
    });
    await page.goto('http://nav-modal.test');await page.addStyleTag({content:css});await page.addScriptTag({content:script});
    await expect(page.locator('#mobile-bottom-bar')).toBeVisible();
}

async function recordFrames(page:Page, button: string){
    return page.getByRole('button',{name:button,exact:true}).evaluate(async node=>{
        const frames:{overlay:boolean;visibleControls:string[];ghosts:number}[]=[];
        const sample=()=>{
            const overlay=!!document.querySelector('.dashboard-modal-overlay,#sheet-wrapper,#deposit-sheet-wrapper');
            const visibleControls=['mobile-nav-capsule','wal'].filter(id=>{
                const element=document.getElementById(id);if(!element)return false;
                const style=getComputedStyle(element);return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0;
            });
            frames.push({overlay,visibleControls,ghosts:document.querySelectorAll('[id^="ghost-bottom-bar"],[id^="ghost-deposit-bar"]').length});
        };
        const start=performance.now();(node as HTMLButtonElement).click();
        await new Promise<void>(resolve=>{const tick=()=>{sample();if(performance.now()-start<700)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
        return frames;
    });
}

for(const reduced of [false,true]) for(const kind of ['send','deposit','dialog'])test(`${kind} never paints bottom-bar controls over its entrance${reduced?' with reduced motion':''}`,async({page},info)=>{
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await fixture(page);
    const frames=await recordFrames(page,`Open ${kind}`);
    expect(frames.some(frame=>frame.overlay)).toBe(true);
    expect(frames.filter(frame=>frame.overlay&&(frame.visibleControls.length||frame.ghosts))).toEqual([]);
    await page.screenshot({path:info.outputPath(`${kind}-open.png`)});
    const closeName=kind==='send'?'Close send dialog':kind==='deposit'?'Close':'Cancel';
    const closingFrames=await recordFrames(page,closeName);
    expect(closingFrames.filter(frame=>frame.overlay&&(frame.visibleControls.length||frame.ghosts))).toEqual([]);
    await expect(page.locator('#mobile-nav-capsule')).toBeVisible();
    await expect(page.locator('#wal')).toBeVisible();
});

test('the bar stays hidden while either overlay exists and returns after the last one closes',async({page})=>{
    await page.setViewportSize({width:390,height:844});await fixture(page);
    await page.evaluate(()=>{
        for(const id of ['first-modal','second-modal']){const modal=document.createElement('div');modal.id=id;modal.className='dashboard-modal-overlay';document.body.appendChild(modal);}
    });
    await expect(page.locator('#mobile-nav-capsule')).toBeHidden();await expect(page.locator('#wal')).toBeHidden();
    await page.evaluate(()=>document.getElementById('first-modal')!.remove());
    await expect(page.locator('#mobile-nav-capsule')).toBeHidden();
    await page.evaluate(()=>document.getElementById('second-modal')!.remove());
    await expect(page.locator('#mobile-nav-capsule')).toBeVisible();await expect(page.locator('#wal')).toBeVisible();
});
