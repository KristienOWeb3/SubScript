import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { dashboardStyles } from "./fixtures/dashboard-render";

let script: string;
let css: string;
test.beforeAll(async () => {
    const [bundle, styles] = await Promise.all([
        build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import NotificationBell from './src/components/dashboard/NotificationBell'; createRoot(document.getElementById('root')).render(<NotificationBell audience="USER" accent="#2775CA"/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } }),
        dashboardStyles(),
    ]);
    script = bundle.outputFiles[0].text; css = styles;
});

type Notice = { id: string; title: string; body: string; url: string | null; source: string; readAt: string | null; createdAt: string };
function notice(id: string, overrides: Partial<Notice> = {}): Notice {
    return { id, title: `Notice ${id}`, body: 'A payment update for your account.', url: null, source: 'SYSTEM', readAt: null, createdAt: new Date().toISOString(), ...overrides };
}
async function fixture(page: Page, notices = [notice('1'), notice('2'), notice('3')]) {
    const calls: {method: string; url: string; body: Record<string, unknown> | null}[] = [];
    const state = { items: notices, readStatus: 200, deleteStatus: 200, loadStatus: 200 };
    await page.route('**/*', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.pathname !== '/api/notifications') {
            const asset=path.resolve('public',url.pathname.slice(1));
            if (asset.startsWith(path.resolve('public')+path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) return route.fulfill({path:asset});
            return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><body style="margin:0;background:#FFFFF0"><div id="root" style="position:fixed;top:20px;right:20px"></div><button id="outside" style="margin-top:300px">Outside panel</button></body></html>'});
        }
        const body = request.method() === 'POST' ? request.postDataJSON() : null;
        calls.push({method:request.method(),url:request.url(),body});
        if (request.method() === 'POST') {
            if (state.readStatus !== 200) return route.fulfill({status:state.readStatus,json:{error:'Read failed'}});
            state.items=state.items.map(item=>body.all || body.ids?.includes(item.id) ? {...item,readAt:new Date().toISOString()} : item);
        }
        if (request.method() === 'DELETE') {
            if (state.deleteStatus !== 200) return route.fulfill({status:state.deleteStatus,json:{error:'Delete failed'}});
            state.items=state.items.filter(item=>url.searchParams.get('allRead')==='true' ? !item.readAt : item.id!==url.searchParams.get('id'));
        }
        return route.fulfill({status:request.method()==='GET'?state.loadStatus:200,json:{success:true,notifications:state.items,unreadCount:state.items.filter(item=>!item.readAt).length}});
    });
    await page.goto('http://notifications.test');
    await page.addStyleTag({content:css}); await page.addScriptTag({content:script});
    await expect(page.getByRole('button',{name:`Notifications${notices.filter(item=>!item.readAt).length ? `, ${notices.filter(item=>!item.readAt).length} unread` : ''}`,exact:true})).toBeVisible();
    return {state,calls};
}
const dialog = (page: Page) => page.getByRole('dialog',{name:'Notifications',exact:true});
async function open(page: Page) {
    await page.getByRole('button',{name:/^Notifications(?:, \d+ unread)?$/}).click();
    await expect(dialog(page)).toBeVisible();
}

test('mobile taps inside the panel keep it open and mark exactly one notification',async({page},info)=>{
    await page.setViewportSize({width:390,height:844});
    const {calls}=await fixture(page); await open(page);
    await dialog(page).getByRole('button',{name:/Notice 1/}).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[data-unread="false"]')).toHaveCount(1);
    await expect.poll(()=>calls.filter(call=>call.method==='POST')).toHaveLength(1);
    await page.screenshot({path:info.outputPath('mobile-notification-panel.png')});
});

test('closing after one read preserves the remaining unread badge',async({page})=>{
    await page.setViewportSize({width:1280,height:800});
    const {calls}=await fixture(page); await open(page);
    await dialog(page).getByRole('button',{name:/Notice 1/}).click();
    await expect.poll(()=>calls.filter(call=>call.method==='POST')).toHaveLength(1);
    await dialog(page).getByRole('button',{name:'Close notifications',exact:true}).click();
    await expect(page.getByRole('button',{name:'Notifications, 2 unread',exact:true})).toBeVisible();
});

test('failed read can retry without losing the notification or unread count',async({page})=>{
    const {state,calls}=await fixture(page); state.readStatus=503; await open(page);
    await dialog(page).getByRole('button',{name:/Notice 1/}).click();
    await expect(dialog(page).locator('[data-unread="true"]')).toHaveCount(3);
    await expect.poll(()=>calls.filter(call=>call.method==='POST')).toHaveLength(1);
    state.readStatus=200;
    await dialog(page).getByRole('button',{name:/Notice 1/}).click();
    await expect(dialog(page).locator('[data-unread="false"]')).toHaveCount(1);
});

test('failed close cleanup restores read rows and permits another cleanup attempt',async({page})=>{
    const {state,calls}=await fixture(page,[notice('1',{readAt:new Date().toISOString()}),notice('2')]);
    state.deleteStatus=503; await open(page);
    await dialog(page).getByRole('button',{name:'Close notifications',exact:true}).click();
    await expect.poll(()=>calls.filter(call=>call.method==='DELETE')).toHaveLength(1);
    state.loadStatus=503; await open(page);
    await expect(dialog(page).getByText('Notice 1',{exact:true})).toBeVisible();
    state.deleteStatus=200;
    await dialog(page).getByRole('button',{name:'Close notifications',exact:true}).click();
    await expect.poll(()=>calls.filter(call=>call.method==='DELETE')).toHaveLength(2);
});

test('older notification pages stay visible through background refresh',async({page})=>{
    await page.clock.install();
    await fixture(page);
    const older=notice('older',{createdAt:'2026-01-01T00:00:00.000Z'});
    let pages=0;
    await page.route('**/api/notifications?*',route=>{
        const cursor=new URL(route.request().url()).searchParams.get('cursor');
        if(cursor) pages++;
        return route.fulfill({json:{notifications:cursor?[notice('3'),older]:[notice('1'),notice('2'),notice('3')],unreadCount:4,nextCursor:cursor?null:'next-page'}});
    });
    await open(page);
    await dialog(page).getByRole('button',{name:'Load more notifications',exact:true}).click();
    await expect(dialog(page).getByText('Notice older',{exact:true})).toBeVisible();
    await expect(dialog(page).locator('li')).toHaveCount(4);
    await expect(dialog(page).getByRole('button',{name:'Load more notifications',exact:true})).toHaveCount(0);
    await page.clock.fastForward(15_000);
    await expect(dialog(page).getByText('Notice older',{exact:true})).toBeVisible();
    expect(pages).toBe(1);
});

test('a stale refresh cannot overwrite an optimistic read',async({page})=>{
    const {calls}=await fixture(page);
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    let started=false;
    await page.route('**/api/notifications?*',async route=>{
        if(route.request().method()!=='GET') return route.fallback();
        started=true; await held;
        await route.fulfill({json:{notifications:[notice('1'),notice('2'),notice('3')],unreadCount:3}}).catch(()=>{});
    });
    await open(page); await expect.poll(()=>started).toBe(true);
    await dialog(page).getByRole('button',{name:/Notice 1/}).click();
    await expect.poll(()=>calls.filter(call=>call.method==='POST')).toHaveLength(1);
    release();
    await expect(dialog(page).locator('[data-unread="false"]')).toHaveCount(1);
    await expect(dialog(page).getByText('2 new',{exact:true})).toBeVisible();
});

test('closing waits for the read receipt before clearing read notifications',async({page})=>{
    const {calls}=await fixture(page);
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    let started=false;
    await page.route('**/api/notifications',async route=>{
        if(route.request().method()!=='POST') return route.fallback();
        started=true; await held; await route.fallback();
    });
    await open(page);
    await dialog(page).getByRole('button',{name:/Notice 1/}).click();
    await expect.poll(()=>started).toBe(true);
    await dialog(page).getByRole('button',{name:'Close notifications',exact:true}).click();
    expect(calls.filter(call=>call.method==='DELETE')).toHaveLength(0);
    release();
    await expect.poll(()=>calls.filter(call=>call.method==='DELETE')).toHaveLength(1);
    await expect(page.getByRole('button',{name:'Notifications, 2 unread',exact:true})).toBeVisible();
});

test('only visible transient notifications are cleared and failed deletion can retry',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const {state,calls}=await fixture(page,[notice('visible',{source:'BRIDGE'}),...Array.from({length:15},(_,index)=>notice(String(index))),notice('unseen',{source:'BRIDGE'})]);
    state.deleteStatus=503; await open(page);
    await expect(dialog(page).getByText('Notice visible',{exact:true})).toBeInViewport();
    await expect(dialog(page).getByText('Notice unseen',{exact:true})).not.toBeInViewport();
    await dialog(page).getByRole('button',{name:'Close notifications',exact:true}).click();
    await expect.poll(()=>calls.filter(call=>call.method==='DELETE')).toHaveLength(1);
    expect(calls.filter(call=>call.method==='DELETE')[0].url).toContain('id=visible');
    state.deleteStatus=200; await open(page);
    await expect(dialog(page).getByText('Notice visible',{exact:true})).toBeInViewport();
    await dialog(page).getByRole('button',{name:'Close notifications',exact:true}).click();
    await expect.poll(()=>calls.filter(call=>call.method==='DELETE')).toHaveLength(2);
    await expect(page.getByRole('button',{name:'Notifications, 16 unread',exact:true})).toBeVisible();
});

test('Escape returns focus to the bell and outside taps close the panel',async({page})=>{
    await fixture(page); await open(page);
    await dialog(page).getByRole('button',{name:'Close notifications',exact:true}).focus();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Notifications, 3 unread',exact:true})).toBeFocused();
    await open(page); await page.locator('#outside').click();
    await expect(dialog(page)).toHaveCount(0);
});

for (const [width,height] of [[320,568],[390,844],[667,375],[1280,800]]) test(`notification panel has one content tree and fits ${width}x${height}`,async({page},info)=>{
    await page.setViewportSize({width,height});
    await fixture(page,[notice('1',{title:'A'.repeat(140),body:'B'.repeat(200)}),...Array.from({length:12},(_,index)=>notice(String(index+2)))]);
    await open(page);
    await expect(page.locator('.notification-panel')).toHaveCount(1);
    const bounds=await dialog(page).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(height);
    expect(await dialog(page).evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await expect(dialog(page).getByRole('button',{name:'Close notifications',exact:true})).toBeInViewport();
    await page.screenshot({path:info.outputPath(`notifications-${width}.png`)});
});
