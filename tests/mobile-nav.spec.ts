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
const script = buildSync({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import MobileFloatingNav from './src/components/dashboard/MobileFloatingNav';
    import { Home, Shield, Link2, Layers } from './src/components/icons';
    const tabs = [{id:'home',label:'Home',icon:Home},{id:'commit',label:'Commit',icon:Shield},{id:'links',label:'Links',icon:Link2},{id:'batch',label:'Batch',icon:Layers}];
    function Fixture() {
      const [activeTab,setActiveTab]=React.useState('home');
      return <div className="user-dashboard-redesign" style={{height:'100dvh',background:'#FFFFF0'}}><div className="user-dashboard-content" style={{height:'100dvh',overflow:'auto'}}><div style={{height:1600}}>Selected: {activeTab}</div></div><MobileFloatingNav tabs={tabs} activeTab={activeTab} onSelectTab={setActiveTab} /></div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;

for (const reduced of [false, true]) {
  test(`mobile tab highlight glides and interrupted selections settle${reduced ? " with reduced motion" : ""}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => {
      const asset = new URL(route.request().url()).pathname;
      if (/^\/icons\/[\w./-]+\.svg$/.test(asset)) {
        const file = path.join(process.cwd(), "public", asset);
        if (fs.existsSync(file)) return route.fulfill({ path: file });
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html data-theme='light'><body><div id='root'></div></body></html>" });
    });
    await page.goto("http://nav.test");
    await page.addStyleTag({ content: stylesheet });
    await page.addScriptTag({ content: script });
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    const commit = nav.getByRole("button", { name: "Commit", exact: true });
    await expect(nav.getByRole("button", { name: "Home", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(700);
    await page.screenshot({ path: testInfo.outputPath("nav-home.png") });
    const samples = await commit.evaluate(async button => {
      const samples: { width: number; textWidth: number; revealWidth: number }[] = [];
      const text = button.querySelector<HTMLElement>("[data-nav-label]")!;
      (button as HTMLButtonElement).click();
      let recording = true;
      const record = () => {
        samples.push({
          width: button.getBoundingClientRect().width,
          textWidth: text.getBoundingClientRect().width,
          revealWidth: text.parentElement!.getBoundingClientRect().width,
        });
        if (recording) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
      await new Promise(resolve => setTimeout(resolve, 700));
      recording = false;
      return samples;
    });
    expect(samples.some(sample => sample.width > 37 && sample.width < 89)).toBe(!reduced);
    // The reveal clips naturally sized text; characters must not stretch or remeasure mid-flight.
    const textWidth = samples.at(-1)!.textWidth;
    expect(textWidth).toBeGreaterThan(0);
    expect(samples.every(sample => Math.abs(sample.textWidth - textWidth) < 0.1)).toBe(true);
    expect(samples.at(-1)!.revealWidth).toBeCloseTo(textWidth, 1);
    expect(samples.some(sample => sample.revealWidth > 1 && sample.revealWidth < textWidth - 1)).toBe(!reduced);
    for (let index = 1; index < samples.length; index++) {
      expect(samples[index].revealWidth).toBeGreaterThanOrEqual(samples[index - 1].revealWidth - 0.1);
    }
    expect((await commit.boundingBox())!.width).toBeCloseTo(90, 0);
    await page.screenshot({ path: testInfo.outputPath("nav-commit.png") });
    for (const label of ["Links", "Batch", "Home", "Links"]) {
      await nav.getByRole("button", { name: label, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(700);
    const links = nav.getByRole("button", { name: "Links", exact: true });
    await expect(links).toHaveAttribute("aria-current", "page");
    expect((await links.boundingBox())!.width).toBeCloseTo(90, 0);
    await expect(page.getByTestId("mobile-nav-selection")).toHaveCount(1);
    const [pill, button] = await Promise.all([page.getByTestId("mobile-nav-selection").boundingBox(), links.boundingBox()]);
    expect(pill!.x).toBeCloseTo(button!.x, 0);
    expect(pill!.width).toBeCloseTo(button!.width, 0);
    await page.getByRole("button", { name: "Open Payments", exact: true }).click();
    await page.waitForTimeout(700);
    await expect(page.getByRole("button", { name: "Open Payments", exact: true })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("button", { name: "Home", exact: true }).click();
    await page.waitForTimeout(700);
    await expect(nav.getByRole("button", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    expect(errors).toEqual([]);
  });
}
