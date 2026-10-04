import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const cssDirectory = path.resolve(".next/dev/static/chunks");
const stylesheetName = fs.existsSync(cssDirectory)
    ? fs.readdirSync(cssDirectory).find(name => name.startsWith("src_app_globals_css_") && name.endsWith(".css"))
    : undefined;
let stylesheet = stylesheetName ? fs.readFileSync(path.join(cssDirectory, stylesheetName), "utf8") : "";

test.beforeAll(async () => {
    if (stylesheet) return;
    const source = path.resolve("src/app/globals.css");
    stylesheet = (await postcss([tailwindcss({ base: process.cwd() })]).process(
        fs.readFileSync(source, "utf8"), { from: source },
    )).css;
});

const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const script = buildSync({
    stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import DepositModal from './src/components/DepositModal';
        import SendSingleModal from './src/components/SendSingleModal';
        function Fixture() {
            const [open, setOpen] = React.useState(true);
            const [sendOpen, setSendOpen] = React.useState(false);
            return React.createElement(React.Fragment, null,
                React.createElement('button', { onClick: () => setOpen(true) }, 'Reopen deposit'),
                React.createElement('button', { onClick: () => { setOpen(false); setSendOpen(true); } }, 'Show send'),
                React.createElement(SendSingleModal, { open: sendOpen, onClose: () => setSendOpen(false),
                    onSubmit: async () => {}, getQuote: async () => {}, recipient: '', onRecipientChange: () => {},
                    amount: '', onAmountChange: () => {}, resolving: false, resolved: null, selfSend: false,
                    loading: false, status: null, walletBalance: 100, onScanQr: () => {}, onGoToBatch: () => {} }),
                React.createElement(DepositModal, { isOpen: open, onClose: () => setOpen(false),
                    depositAddress: '${address}', onSuccess: () => {} }));
        }
        createRoot(document.getElementById('root')).render(React.createElement(Fixture));`,
        resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife",
    alias: { "@/lib/wagmi": path.resolve("tests/fixtures/deposit-chain.ts") },
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
}).outputFiles[0].text;

for (const width of [390, 1280]) for (const reducedMotion of [false, true]) {
    test(`Deposit crypto and Onramp stay separate at ${width}px${reducedMotion ? " with reduced motion" : ""}`, async ({ page, context }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await context.route("**/*", route => {
            const url = new URL(route.request().url());
            const assetPath = url.pathname === "/_next/image" ? url.searchParams.get("url") : url.pathname;
            if (assetPath && /^\/(?:chains|logos|icons)\/[\w./-]+\.(?:svg|png)$/.test(assetPath)) {
                const localAsset = path.join(process.cwd(), "public", assetPath);
                if (fs.existsSync(localAsset)) return route.fulfill({ path: localAsset });
            }
            return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><div id='root'></div></body></html>" });
        });
        await page.goto("http://deposit.test");
        await page.evaluate(() => {
            const recorded: { element: string; duration: number; delay: number }[] = [];
            const original = Element.prototype.animate;
            Element.prototype.animate = function (frames, options) {
                if (this.id.startsWith("deposit-")) {
                    const timing = typeof options === "number" ? { duration: options } : options;
                    recorded.push({ element: this.id, duration: Number(timing?.duration || 0), delay: Number(timing?.delay || 0) });
                }
                return original.call(this, frames, options);
            };
            (window as unknown as { depositAnimations: typeof recorded }).depositAnimations = recorded;
        });
        if (stylesheet) await page.addStyleTag({ content: stylesheet });
        await page.addScriptTag({ content: script });
        const dialog = page.getByRole("dialog");
        const crypto = dialog.getByRole("tab", { name: "Deposit crypto" });
        const onramp = dialog.getByRole("tab", { name: "Onramp", exact: true });
        await expect(onramp.locator('[data-icon="Building2"]')).toHaveCount(1);
        await expect(crypto).toHaveAttribute("aria-selected", "true");
        await page.waitForTimeout(700); // Measure both tabs after the open animation settles.
        const [cryptoBounds, onrampBounds] = await dialog.getByRole("tab").evaluateAll(tabs =>
            tabs.map(tab => {
                const { x, y, width } = tab.getBoundingClientRect();
                return { x, y, width };
            }),
        );
        expect(cryptoBounds).not.toBeNull();
        expect(onrampBounds).not.toBeNull();
        expect(Math.abs(cryptoBounds!.width - onrampBounds!.width)).toBeLessThan(1);
        expect(Math.abs(cryptoBounds!.y - onrampBounds!.y)).toBeLessThan(1);
        expect(cryptoBounds!.x + cryptoBounds!.width).toBeLessThanOrEqual(onrampBounds!.x);
        await expect(dialog.getByText("Current Balance", { exact: true })).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "Buy USDC", exact: true })).toHaveCount(0);
        await onramp.evaluate(tab => {
            tab.addEventListener("click", () => {
                const samples: { blur: number; transform: string; height: number }[] = [];
                const capture = () => {
                    const node = document.querySelector('[data-testid="deposit-method-panel"][data-method="onramp"]');
                    if (!node) return;
                    const style = getComputedStyle(node);
                    samples.push({ blur: Number(style.filter.match(/blur\(([\d.]+)px\)/)?.[1] || 0),
                        transform: style.transform, height: node.parentElement!.getBoundingClientRect().height });
                };
                const observer = new MutationObserver(capture);
                observer.observe(document.body, { subtree: true, attributes: true, childList: true });
                (window as unknown as { depositMotionSamples: Promise<typeof samples> }).depositMotionSamples = new Promise(resolve => {
                    window.setTimeout(() => { capture(); observer.disconnect(); resolve(samples); }, 600);
                });
            }, { once: true });
        });
        await onramp.click();
        await expect(onramp).toHaveAttribute("aria-selected", "true");
        const motionSamples = await page.evaluate(() => (window as unknown as { depositMotionSamples: Promise<{ blur: number; transform: string; height: number }[]> }).depositMotionSamples);
        expect(motionSamples.some(sample => sample.blur > 0.5)).toBe(!reducedMotion);
        expect(motionSamples.some(sample => sample.transform !== "none")).toBe(!reducedMotion);
        expect(motionSamples.at(-1)!.blur).toBeLessThan(0.1);
        if (width >= 768 && !reducedMotion) {
            expect(Math.max(...motionSamples.map(sample => sample.height)) - Math.min(...motionSamples.map(sample => sample.height))).toBeGreaterThan(100);
        }
        await expect(dialog.getByRole("button", { name: "Buy USDC", exact: true })).toBeEnabled();
        await expect(dialog.getByRole("button", { name: "Buy USDC", exact: true }).locator('[data-icon="Building2"]')).toHaveCount(1);
        await expect(dialog.getByText("Select the network", { exact: false })).toHaveCount(0);
        await crypto.click();
        await expect(dialog.getByRole("button", { name: /Arc Testnet/ })).toBeEnabled();
        await dialog.getByRole("button", { name: /Arc Testnet/ }).click();
        await expect(dialog.getByRole("heading", { name: "Deposit via Arc Network" })).toBeVisible();
        await expect(dialog.getByText(address, { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "Back to networks" }).click();
        await expect(crypto).toHaveAttribute("aria-selected", "true");
        await page.waitForTimeout(700); // Let the mobile page swap animation finish before visual QA.
        await page.screenshot({ path: testInfo.outputPath(`deposit-crypto-${width}.png`) });
        await onramp.click();
        await expect(onramp).toHaveAttribute("aria-selected", "true");
        await page.waitForTimeout(500);
        await page.screenshot({ path: testInfo.outputPath(`deposit-onramp-${width}.png`) });
        await dialog.getByRole("button", { name: width < 768 ? "Close" : "Close deposit dialog", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        await expect(dialog).toHaveCount(0);
        if (width < 768) {
            const timings = await page.evaluate(() => (window as unknown as { depositAnimations: { duration: number; delay: number }[] }).depositAnimations);
            expect(timings.length).toBeGreaterThan(3);
            expect(timings.every(timing => timing.duration <= 1 && timing.delay === 0)).toBe(reducedMotion);
        }
        expect(errors).toEqual([]);
        await page.getByRole("button", { name: "Reopen deposit" }).click();
        await expect(crypto).toHaveAttribute("aria-selected", "true");
        await dialog.getByRole("button", { name: width < 768 ? "Close" : "Close deposit dialog", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await page.getByRole("button", { name: "Show send", exact: true }).click();
        const sendDialog = page.getByRole("dialog");
        await expect(sendDialog.getByRole("button", { name: /Offramp/ })).toBeDisabled();
        await expect(sendDialog.getByText("Local bank", { exact: true })).toHaveCount(0);
        await page.waitForTimeout(700);
        await page.screenshot({ path: testInfo.outputPath(`send-reference-${width}.png`) });
    });
}
