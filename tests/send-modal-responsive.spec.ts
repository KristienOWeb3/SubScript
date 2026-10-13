import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { dashboardStyles } from "./fixtures/dashboard-render";

let script: string;
let css: string;

test.beforeAll(async () => {
    const [bundle, styles] = await Promise.all([
        build({
            stdin: {
                contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import SendSingleModal from './src/components/SendSingleModal';
import MobileFloatingNav from './src/components/dashboard/MobileFloatingNav';
import {Home, Shield, Link2, Layers} from './src/components/icons';
const tabs=[{id:'home',label:'Home',icon:Home},{id:'commit',label:'Commit',icon:Shield},{id:'links',label:'Links',icon:Link2},{id:'batch',label:'Batch',icon:Layers}];
const address='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const quote=async({amount})=>({amountUsdc:amount,feeUsdc:'0.001',recipientUsdc:amount,totalDebitUsdc:String(Number(amount)+0.001),feeTreatment:'additional',feeLabel:'Network fee',arrival:'10 seconds',estimated:false});
function Fixture(){
 const [open,setOpen]=React.useState(false); const [recipient,setRecipient]=React.useState('alice.sub'); const [amount,setAmount]=React.useState('10');
 return <div className="user-dashboard-redesign" style={{height:'100dvh',background:'#FFFFF0'}}>
  <div className="user-dashboard-content" style={{height:'100dvh',overflow:'auto'}}><button onClick={()=>setOpen(true)}>Open send</button></div>
  <MobileFloatingNav tabs={tabs} activeTab="home" onSelectTab={()=>{}} isLocked={open}/>
  <SendSingleModal open={open} onClose={()=>setOpen(false)} onSubmit={async()=>{}} getQuote={quote}
   recipient={recipient} onRecipientChange={setRecipient} amount={amount} onAmountChange={setAmount}
   resolving={false} resolved={{address,alias:'alice.sub',hasAccount:true}} selfSend={false} loading={false} status={null}
   walletBalance={100} onScanQr={()=>{}} onGoToBatch={()=>{}} recentTransactions={[]}/>
 </div>;
}; createRoot(document.getElementById('root')).render(<Fixture/>);
`,
                resolveDir: process.cwd(),
                loader: "tsx",
            },
            bundle: true,
            write: false,
            platform: "browser",
            format: "iife",
            jsx: "automatic",
            alias: { "@/lib/wagmi": path.resolve("tests/fixtures/deposit-chain.ts") },
            define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
        }),
        dashboardStyles(),
    ]);
    script = bundle.outputFiles[0].text;
    css = styles;
});

async function fixture(page: Page) {
    await page.route("**/*", route => {
        const url = new URL(route.request().url());
        const asset = path.resolve("public", url.pathname.slice(1));
        if (asset.startsWith(path.resolve("public") + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) return route.fulfill({ path: asset });
        if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { routes: [] } });
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="light"><body style="margin:0"><div id="root"></div></body></html>' });
    });
    await page.goto("http://send-responsive.test");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await page.getByRole("button", { name: "Open send", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Send USDC", exact: true })).toBeVisible();
    await page.waitForTimeout(650);
}

async function expectBottomSheet(page: Page) {
    const sheet = page.getByTestId("send-sheet");
    const geometry = await sheet.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            left: rect.left, right: innerWidth - rect.right, top: rect.top, bottom: innerHeight - rect.bottom,
            width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            corners: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius],
            clipPath: style.clipPath,
        };
    });
    expect(geometry.left).toBe(0);
    expect(geometry.right).toBe(0);
    expect(geometry.bottom).toBe(0);
    expect(geometry.top).toBeGreaterThanOrEqual(12);
    expect(geometry.width).toBe(await page.evaluate(() => innerWidth));
    expect(geometry.corners).toEqual(["28px", "28px", "0px", "0px"]);
    expect(geometry.clipPath).toContain("round 28px");
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    await expect(page.locator("#mobile-nav-capsule")).toBeHidden();
    await expect(page.locator("#wal")).toBeHidden();
}

for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 600, height: 320 }]) {
    test(`send fills the bottom with rounded top corners and usable review at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
        await page.setViewportSize(viewport);
        await fixture(page);
        await page.screenshot({ path: info.outputPath("compose.png") });
        await expectBottomSheet(page);
        const review = page.getByTestId("send-review");
        await expect(review).toBeEnabled();
        await review.click();
        await page.waitForTimeout(1000);
        const slider = page.getByRole("button", { name: "Slide to send", exact: true });
        await expect(slider).toBeVisible();
        await slider.scrollIntoViewIfNeeded();
        expect(await slider.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('button[aria-label="Slide to send"]') === element;
        })).toBe(true);
        await page.screenshot({ path: info.outputPath("review.png") });
        await expectBottomSheet(page);
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await page.waitForTimeout(1000);
        await page.getByRole("button", { name: "Close send dialog", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Send USDC", exact: true })).toBeHidden();
        await expect(page.locator("#mobile-nav-capsule")).toBeVisible();
        await expect(page.locator("#wal")).toBeVisible();
    });
}

test("send stays inside the viewport when resized while open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page);
    await page.setViewportSize({ width: 320, height: 360 });
    await expectBottomSheet(page);
    const sheet = page.getByTestId("send-sheet");
    expect(await sheet.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.getByTestId("send-review").click();
    await expect(page.getByRole("button", { name: "Slide to send", exact: true })).toBeVisible();
});

test("scrolled Review paints curved top corners instead of a square edge", async ({ page }, info) => {
    await page.setViewportSize({ width: 355, height: 400 });
    await fixture(page);
    await page.getByTestId("send-review").click();
    await expect(page.locator('#sheet-page-content')).not.toHaveAttribute('inert');
    await page.getByRole("button", { name: "Slide to send", exact: true }).scrollIntoViewIfNeeded();
    const sheet = page.getByTestId("send-sheet");
    expect(await sheet.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const bounds = (await sheet.boundingBox())!;
    const screenshot = await page.screenshot({ path: info.outputPath("scrolled-review-corners.png") });
    const { data, info: pixels } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const brightness = (x: number, y: number) => {
        const offset = (Math.floor(y) * pixels.width + Math.floor(x)) * pixels.channels;
        return data[offset] + data[offset + 1] + data[offset + 2];
    };
    // The middle can contain a scrolled avatar; the side gutter is always the card background.
    const background = brightness(bounds.x + 6, bounds.y + 36);
    expect(brightness(bounds.x + 2, bounds.y + 2)).toBeLessThan(background - 150);
    expect(brightness(bounds.x + bounds.width - 3, bounds.y + 2)).toBeLessThan(background - 150);
    expect(brightness(bounds.x + 2, bounds.y + bounds.height - 2)).toBeGreaterThan(600);
    expect(brightness(bounds.x + bounds.width - 3, bounds.y + bounds.height - 2)).toBeGreaterThan(600);
});
