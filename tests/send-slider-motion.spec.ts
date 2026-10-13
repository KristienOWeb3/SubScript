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
const address='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const quote=async({amount})=>({amountUsdc:amount,feeUsdc:'0.001',recipientUsdc:amount,totalDebitUsdc:String(Number(amount)+0.001),feeTreatment:'additional',feeLabel:'Network fee',arrival:'10 seconds',estimated:false});
function Fixture(){
 const [open,setOpen]=React.useState(false);const [recipient,setRecipient]=React.useState('alice.sub');const [amount,setAmount]=React.useState('10');
 return <div className="user-dashboard-redesign" style={{height:'100dvh',background:'#FFFFF0'}}>
 <button onClick={()=>setOpen(true)}>Open send</button>
 <SendSingleModal open={open} onClose={()=>setOpen(false)} onSubmit={async()=>{throw Error('This motion fixture must never submit a transfer');}} getQuote={quote}
 recipient={recipient} onRecipientChange={setRecipient} amount={amount} onAmountChange={setAmount} resolving={false}
 resolved={{address,alias:'alice.sub',hasAccount:true}} selfSend={false} loading={false} status={null} walletBalance={100}
 onScanQr={()=>{}} onGoToBatch={()=>{}} recentTransactions={[]}/></div>;
}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
            alias: { "@/lib/wagmi": path.resolve("tests/fixtures/deposit-chain.ts") },
            define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } }),
        dashboardStyles(),
    ]);
    script = bundle.outputFiles[0].text; css = styles;
});

async function fixture(page: Page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/*", route => {
        const pathname = new URL(route.request().url()).pathname;
        const asset = path.resolve("public", pathname.slice(1));
        if (asset.startsWith(path.resolve("public") + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) return route.fulfill({ path: asset });
        if (pathname.startsWith("/api/")) return route.fulfill({ json: { configured: true, required: true, routes: [] } });
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="light"><body style="margin:0"><div id="root"></div></body></html>' });
    });
    await page.goto("http://localhost:9878"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
    await page.getByRole("button", { name: "Open send", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Send USDC", exact: true })).toBeVisible();
    await page.waitForTimeout(600); await page.getByTestId("send-review").click();
    await expect(page.locator("#sheet-page-content")).not.toHaveAttribute("inert");
    const slider = page.getByRole("button", { name: "Slide to send", exact: true });
    await slider.scrollIntoViewIfNeeded();
    await slider.evaluate(element => element.addEventListener("pointerdown", event => {
        (window as unknown as { dragTime: number }).dragTime = (event as PointerEvent).timeStamp;
    }, { capture: true }));
    const box = (await slider.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    return { slider, x, y };
}

async function moveAndRead(page: Page, x: number, y: number, elapsed: number, pausedClock = false) {
    await page.getByRole("button", { name: "Slide to send", exact: true }).evaluate((element, data) => {
        const event = new PointerEvent("pointermove", { pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: data.x, clientY: data.y, bubbles: true });
        const state = window as unknown as { dragTime: number };
        state.dragTime += data.elapsed;
        Object.defineProperty(event, "timeStamp", { value: state.dragTime });
        element.dispatchEvent(event);
    }, { x, y, elapsed });
    if (pausedClock) await page.clock.runFor(17);
    else await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    return readBlur(page);
}

async function readBlur(page: Page) {
    return page.getByRole("button", { name: "Slide to send", exact: true }).evaluate(element => {
        const effect = element.querySelector<HTMLElement>("[data-slider-blur]")!;
        const filter = effect.style.filter;
        const id = /#([^"\)]+)/.exec(filter)?.[1];
        return { deviation: id ? document.getElementById(id)!.firstElementChild!.getAttribute("stdDeviation")! : "0 0", filter };
    });
}

async function blur(page: Page) { return (await readBlur(page)).deviation; }

test("a burst of pointer events paints the latest position once per frame without resizing the fill", async ({ page }) => {
    const { slider, x, y } = await fixture(page);
    const clockStart = new Date();
    await page.clock.install({ time: clockStart }); await page.clock.pauseAt(new Date(clockStart.getTime() + 100));
    const burst = await slider.evaluate((element, data) => {
        const fill = element.parentElement!.firstElementChild as HTMLElement;
        (window as any).dragPaintWrites = 0;
        const observer = new MutationObserver(records => { (window as any).dragPaintWrites += records.length; });
        observer.observe(element, { attributes: true, attributeFilter: ["style"] });
        observer.observe(fill, { attributes: true, attributeFilter: ["style"] });
        (window as any).dragPaintObserver = observer;
        for (let i = 1; i <= 64; i++) element.dispatchEvent(new PointerEvent("pointermove", {
            pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: data.x + i * 2, clientY: data.y, bubbles: true,
        }));
        return { writes: observer.takeRecords().length, width: fill.style.width };
    }, { x, y });
    expect(burst.writes).toBe(0);
    await page.clock.runFor(17);
    const frame = await slider.evaluate(element => {
        const fill = element.parentElement!.firstElementChild as HTMLElement;
        const observer = (window as any).dragPaintObserver as MutationObserver;
        const writes = (window as any).dragPaintWrites + observer.takeRecords().length; observer.disconnect();
        return { writes, position: new DOMMatrix(getComputedStyle(element).transform).m41,
            fillWidth: fill.style.width, visibleFill: fill.getBoundingClientRect().right - element.parentElement!.getBoundingClientRect().left };
    });
    expect(frame.writes).toBeLessThanOrEqual(3);
    expect(frame.position).toBe(128);
    expect(frame.fillWidth).toBe(burst.width);
    expect(frame.visibleFill).toBeCloseTo(186, 0);
    await page.mouse.up();
});

test("fast dragging produces stronger horizontal blur than slow dragging", async ({ page }) => {
    const { x, y } = await fixture(page);
    const slow = await moveAndRead(page, x + 30, y, 150);
    const fast = await moveAndRead(page, x + 150, y, 16);
    expect(parseFloat(slow.deviation)).toBeGreaterThan(0);
    expect(parseFloat(fast.deviation)).toBeGreaterThan(parseFloat(slow.deviation) * 10);
    expect(parseFloat(fast.deviation)).toBeLessThanOrEqual(9);
    expect(fast.deviation.split(" ")[1]).toBe("0"); expect(fast.filter).toContain("mbx");
    await page.mouse.up();
});

for (const reducedMotion of ["reduce", "no-preference"] as const) test(`sustained dragging paints without layout recalculation (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { x, y } = await fixture(page);
    await moveAndRead(page, x + 10, y, 16);
    expect(await page.locator("#sheet-sending-hero circle").first().evaluate(element => getComputedStyle(element).animationName)).toBe("none");
    const session = await page.context().newCDPSession(page);
    await session.send("Performance.enable");
    const before = await session.send("Performance.getMetrics");
    await page.getByRole("button", { name: "Slide to send", exact: true }).evaluate(async (element, data) => {
        for (let i = 1; i <= 20; i++) {
            element.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, isPrimary: true,
                pointerType: "mouse", clientX: data.x + 10 + i * 6, clientY: data.y, bubbles: true }));
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }, { x, y });
    const after = await session.send("Performance.getMetrics");
    const metric = (metrics: typeof before, name: string) => metrics.metrics.find(item => item.name === name)!.value;
    expect(metric(after, "LayoutCount") - metric(before, "LayoutCount")).toBe(0);
    expect(await page.getByRole("button", { name: "Slide to send", exact: true }).evaluate(element =>
        new DOMMatrix(getComputedStyle(element).transform).m41)).toBe(130);
    await page.mouse.up();
});

test("motion blur decays to clear while the finger pauses", async ({ page }) => {
    const { slider, x, y } = await fixture(page);
    expect(parseFloat((await moveAndRead(page, x + 120, y, 16)).deviation)).toBeGreaterThan(5);
    await expect.poll(() => blur(page), { timeout: 1000 }).toBe("0 0");
    await expect.poll(async () => (await readBlur(page)).filter).toBe("");
    expect(await slider.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41)).toBe(120);
    await page.mouse.up();
});

for (const end of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    test(`${end} immediately clears motion blur`, async ({ page }) => {
        const { slider, x, y } = await fixture(page);
        await moveAndRead(page, x + 120, y, 16);
        const result = await slider.evaluate((element, type) => {
            element.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, pointerType: "mouse", bubbles: true }));
            return element.querySelector<HTMLElement>("[data-slider-blur]")!.style.filter;
        }, end);
        expect(result).toBe(""); await page.mouse.up();
    });
}

test("reduced motion disables blur and changing the preference clears active blur", async ({ page }) => {
    const { x, y } = await fixture(page);
    expect(parseFloat((await moveAndRead(page, x + 80, y, 16)).deviation)).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => blur(page)).toBe("0 0");
    expect(await moveAndRead(page, x + 150, y, 16)).toEqual({ deviation: "0 0", filter: "" });
    await page.mouse.up();
});

test("fast-slide visual keeps a horizontally blurred thumb inside the original track", async ({ page }, info) => {
    const { x, y } = await fixture(page);
    const clockStart = new Date();
    await page.clock.install({ time: clockStart }); await page.clock.pauseAt(new Date(clockStart.getTime() + 100));
    const result = await moveAndRead(page, x + 120, y, 16, true);
    expect(parseFloat(result.deviation)).toBeGreaterThan(5);
    await page.screenshot({ path: info.outputPath("fast-slide-motion-blur.png") });
});
