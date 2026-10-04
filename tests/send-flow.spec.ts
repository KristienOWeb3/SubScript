import { test, expect, type Browser, type Page } from "@playwright/test";
import { decodeFunctionData, encodeFunctionResult, multicall3Abi } from "viem";

const baseURL = process.env.SEND_FLOW_BASE_URL || "http://localhost:3000";
const wallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const recipient = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const hash = `0x${"12".repeat(32)}`;

async function fixture(browser: Browser, width: number, height = 844, emptyHistory = false, reducedMotion = false) {
  const pendingOperations = new Map<string, { status: "pending" | "confirmed" | "failed"; amountMicros: bigint; hash: string }>();
  const state = { independentPending: false, pendingOperations, deposits: [] as Record<string, unknown>[], balanceMicros: 100_000_000n, settledBalanceMicros: 100_000_000n, failSend: false, failedPending: false, pendingSend: false, confirmed: false, sendDelay: 0, receiptFeeMicros: 125_000n, brokenAvatar: false, sent: [] as unknown[] };
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", serviceWorkers: "block", reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await context.addCookies([{ name: "subscript_e2e_test", value: "true", url: baseURL }]);
  await context.addInitScript((empty) => {
    if (empty) return;
    localStorage.setItem("subscript_recent_beneficiaries_by_chain", JSON.stringify([
      { id: "stored-dns", chain: "arc", type: "dns", target: "@Nora.sub", label: "Nora.sub", address: "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29" },
      { id: "stored-wallet", chain: "arc", type: "wallet", target: "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29", label: "0x835A…Fc29" },
    ]));
  }, emptyHistory);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (!path.startsWith("/api/")) {
      if (request.method() === "POST" && !url.host.startsWith("127.0.0.1")) {
        const body = request.postDataJSON();
        const rpc = (item: { id: number; method: string; params?: { data?: string }[] }) => {
          const balance = `0x${state.balanceMicros.toString(16).padStart(64, "0")}` as `0x${string}`;
          let result = item.method === "eth_call" ? balance : item.method === "eth_chainId" ? "0x4cef52" : "0x1";
          if (item.method === "eth_call" && item.params?.[0]?.data?.startsWith("0x82ad56cb")) {
            const call = decodeFunctionData({ abi: multicall3Abi, data: item.params[0].data as `0x${string}` });
            if (call.functionName === "aggregate3") result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: call.args[0].map(() => ({ success: true, returnData: balance })) });
          }
          return { jsonrpc: "2.0", id: item.id, result };
        };
        if (body?.method || Array.isArray(body)) return json(Array.isArray(body) ? body.map(rpc) : rpc(body));
      }
      return route.continue();
    }
    if (path === "/api/auth/session") return json({ loggedIn: true, wallet: wallet.toLowerCase(), email: "qa@example.com", provider: "email_otp", isEmbedded: true, role: "USER" });
    if (path === "/api/user/settings") return json({ success: true, receipts: [], settings: { alias: "qa-user", profilePic: null, payoutDestination: wallet, pushEnabled: false, walletBackup: { available: true, email: "qa@example.com", provider: "email_otp", completedAt: "2026-01-01T00:00:00Z" } } });
    if (path === "/api/merchant/alias") return json({ success: true, address: recipient, alias: "nora.sub", profile_pic: state.brokenAvatar ? "/api/fixture-missing-avatar" : null });
    if (path === "/api/fixture-missing-avatar") return route.fulfill({ status: 404, body: "Missing photo" });
    if (path === "/api/user/wallet/estimate-fee") return json({ recipients: 1, feeUsdc: "0.125", feeMicros: "125000", fallback: false });
    if (path === "/api/user/wallet/send") {
      state.sent.push(request.postDataJSON());
      if (state.sendDelay) await new Promise(resolve => setTimeout(resolve, state.sendDelay));
      if (state.failSend) return json({ success: false, error: "Transfer rejected by test fixture" }, 502);
      const amount = request.postDataJSON().amountUsdc;
      if (state.independentPending) {
        const operationId = `fixture-circle-${state.sent.length}`;
        pendingOperations.set(operationId, { status: "pending", amountMicros: BigInt(Math.round(Number(amount) * 1_000_000)), hash: `0x${String(state.sent.length + 5).repeat(64)}` });
        return json({ success: true, status: "pending", circleTxId: operationId, transfers: [{ receiverAddress: recipient, amountUsdc: String(amount), txHash: null }], networkFee: { type: "ARC_NETWORK_FEE", amountUsdc: "0.125", amountMicros: "125000", txHash: null, charged: false, unrecovered: false, recipientRole: "GAS_FEE_TREASURY" } });
      }
      state.settledBalanceMicros = 100_000_000n - BigInt(Math.round(Number(amount) * 1_000_000)) - state.receiptFeeMicros;
      if (!state.pendingSend) state.balanceMicros = state.settledBalanceMicros;
      return json({ success: true, status: state.pendingSend ? "pending" : "confirmed", circleTxId: state.pendingSend ? "fixture-circle-id" : undefined, transfers: [{ receiverAddress: recipient, amountUsdc: String(amount), txHash: state.pendingSend ? null : hash }], networkFee: { type: "ARC_NETWORK_FEE", amountUsdc: String(Number(state.receiptFeeMicros) / 1_000_000), amountMicros: String(state.receiptFeeMicros), txHash: hash, charged: true, unrecovered: false, recipientRole: "GAS_FEE_TREASURY" } });
    }
    if (path === "/api/user/wallet/send/status") {
      if (state.independentPending) {
        const operation = pendingOperations.get(url.searchParams.get("circleTxId") || "");
        state.balanceMicros = 100_000_000n - [...pendingOperations.values()].filter(item => item.status === "confirmed").reduce((sum, item) => sum + item.amountMicros + state.receiptFeeMicros, 0n);
        return json({ status: operation?.status || "pending", txHash: operation?.status === "confirmed" ? operation.hash : null });
      }
      if (state.confirmed) state.balanceMicros = state.settledBalanceMicros;
      return json({ status: state.failedPending ? "failed" : state.confirmed ? "confirmed" : "pending", txHash: state.confirmed ? hash : null });
    }
    if (path === "/api/user/dms") return json({ success: true, dms: emptyHistory ? [] : ["nora.sub", recipient].map((name, i) => ({ id: `prior-${i}`, senderAddress: wallet, senderName: "qa-user", receiverAddress: recipient, receiverName: name, receiverProfilePic: null, messageType: "PEER_TRANSFER", status: "PAID", amountUsdc: "1000000", txHash: `0x${String(i + 3).repeat(64)}`, createdAt: new Date(Date.now() - i * 60_000).toISOString() })) });
    if (path === "/api/user/deposits") return json({ success: true, deposits: state.deposits });
    if (path === "/api/user/subscriptions") return json({ success: true, subscriptions: [] });
    if (path === "/api/user/vault/config") return json({ success: true, vaults: [], config: null });
    if (path === "/api/user/commit/halt") return json({ success: true, onHold: false });
    if (path === "/api/rates") return json({ rate: 1500, currency: "NGN" });
    return json({ success: true, requests: [], links: [], scan: [] });
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/dashboard/user`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("wallet-actions").getByRole("button", { name: /^Send(\s+Out)?$/i })).toBeVisible({ timeout: 120_000 });
  return { context, page, state };
}

async function openSend(page: Page, mobile: boolean) {
  await page.getByTestId("wallet-actions").getByRole("button", { name: /^Send(\s+Out)?$/i }).click();
  const dialog = page.getByTestId(mobile ? "send-sheet" : "send-desktop");
  await expect(dialog).toBeVisible();
  await dialog.locator("input").first().fill("nora.sub");
  return dialog;
}

async function assertNoGutter(page: Page) {
  const geometry = await page.evaluate(() => ({ inner: innerWidth, html: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, bodyMargin: getComputedStyle(document.body).margin, bodyPadding: getComputedStyle(document.body).paddingRight }));
  expect(geometry.html).toBe(geometry.inner);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.inner + 1);
  expect(geometry.bodyMargin).toBe("0px");
  expect(geometry.bodyPadding).toBe("0px");
}

async function slide(page: Page) {
  const thumb = page.getByRole("button", { name: "Slide to send" });
  await expect(thumb).toBeEnabled();
  const box = await thumb.boundingBox();
  const track = await thumb.locator("..").boundingBox();
  expect(box).not.toBeNull();
  expect(track).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(track!.x + track!.width - 22, box!.y + box!.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("send flow uses platform data", () => {
  test.setTimeout(180_000);
  test("mobile wallet buttons stay bounded through landscape and desktop", async ({ browser }, info) => {
    const { page, context } = await fixture(browser, 390);
    const actions = page.getByTestId("wallet-actions");
    for (const width of [320, 390, 430, 601, 667, 767]) {
      await page.setViewportSize({ width, height: width === 667 ? 375 : 900 });
      const deposit = actions.getByRole("button", { name: "Deposit", exact: true });
      const send = actions.getByRole("button", { name: "Send", exact: true });
      await expect(send).toBeVisible();
      const depositBox = (await deposit.boundingBox())!;
      const sendBox = (await send.boundingBox())!;
      const actionsBox = (await actions.boundingBox())!;
      expect(depositBox.width).toBeLessThanOrEqual(115);
      expect(sendBox.width).toBeLessThanOrEqual(115);
      expect(depositBox.width).toBeGreaterThanOrEqual(80);
      expect(sendBox.width).toBeGreaterThanOrEqual(80);
      expect(actionsBox.width).toBeLessThanOrEqual(290);
      expect(Math.abs(actionsBox.x + actionsBox.width / 2 - width / 2)).toBeLessThan(1);
      await assertNoGutter(page);
      await page.screenshot({ path: info.outputPath(`actions-${width}.png`), style: "nextjs-portal { display: none !important; }" });
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(actions.getByRole("button", { name: "Send Out", exact: true })).toBeVisible();
    expect((await actions.getByRole("button", { name: "Deposit", exact: true }).boundingBox())!.width).toBe(130);
    await context.close();
  });

  for (const reduced of [false, true]) {
    test(`new incoming transactions blur in once${reduced ? " with reduced motion" : ""}`, async ({ browser }, info) => {
      const { page, context, state } = await fixture(browser, 390, 844, false, reduced);
      await expect(page.locator("[data-transaction-id='dm-prior-0'], [data-transaction-id='prior-0']")).toBeVisible();
      await page.evaluate(() => {
        const evidence: { id: string; frames: Keyframe[]; timing: KeyframeAnimationOptions }[] = [];
        (window as unknown as { historyMotion: typeof evidence }).historyMotion = evidence;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (frames, timing) {
          const id = (this as HTMLElement).dataset.transactionId;
          if (id && Array.isArray(frames) && typeof timing === "object") evidence.push({ id, frames, timing });
          return original.call(this, frames, timing);
        };
      });
      state.deposits = [1, 2].map(i => ({ id: `incoming-${i}`, txHash: `0x${String(i + 6).repeat(64)}`, fromAddress: recipient, toAddress: wallet, senderName: `Arrival ${i}`, amountUsdc: "2000000", amountFormatted: "2.00", timestamp: Date.now() + i, status: "confirmed", incoming: true }));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const row = page.locator("[data-transaction-id='incoming-2']");
      await expect(row).toBeAttached();
      if (reduced) {
        await expect(row).toBeVisible();
        expect(await row.evaluate(el => el.getAnimations().length)).toBe(0);
      } else {
        const sample = await row.evaluate(el => {
          const animation = el.getAnimations()[0];
          animation.pause();
          animation.currentTime = 300;
          const style = getComputedStyle(el);
          return { height: el.getBoundingClientRect().height, fullHeight: el.firstElementChild!.getBoundingClientRect().height, opacity: Number(style.opacity), filter: style.filter };
        });
        expect(sample.height).toBeGreaterThan(0);
        expect(sample.height).toBeLessThan(sample.fullHeight);
        expect(sample.opacity).toBeGreaterThan(0);
        expect(sample.opacity).toBeLessThan(1);
        expect(sample.filter).toMatch(/blur\([\d.]+px\)/);
        await page.screenshot({ path: info.outputPath("incoming-blur.png"), style: "nextjs-portal { display: none !important; }" });
        await row.evaluate(el => el.getAnimations()[0].play());
      }
      await expect.poll(() => row.evaluate(el => el.getAnimations().length)).toBe(0);
      expect(await row.evaluate(el => ({ opacity: getComputedStyle(el).opacity, filter: getComputedStyle(el).filter, height: el.style.height }))).toEqual({ opacity: "1", filter: "none", height: "" });
      // A poll, filter change and ledger identity replacement must not replay an arrival.
      state.deposits[1].id = "indexed-incoming-2";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator("[data-transaction-id='indexed-incoming-2']")).toBeVisible();
      await page.getByRole("button", { name: "Deposits", exact: true }).click();
      await page.getByRole("button", { name: "All", exact: true }).click();
      const evidence = await page.evaluate(() => (window as unknown as { historyMotion: { id: string; frames: Keyframe[]; timing: KeyframeAnimationOptions }[] }).historyMotion);
      expect(evidence).toHaveLength(reduced ? 0 : 2);
      if (!reduced) for (const entry of evidence) {
        expect(entry.frames[0]).toEqual({ height: "0px", opacity: 0, filter: "blur(8px)" });
        expect(entry.frames[1].filter).toBe("blur(0px)");
        expect(entry.timing).toMatchObject({ duration: 780, delay: 200, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      }
      await context.close();
    });
  }

  test("reference morph timings, real height interpolation, keyboard send and repeated close", async ({ browser }, info) => {
    const { page, context, state } = await fixture(browser, 390);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(() => {
      const evidence: { id: string; frames: Keyframe[]; timing: KeyframeAnimationOptions }[] = [];
      (window as unknown as { arcMotion: typeof evidence }).arcMotion = evidence;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, timing) {
        if (Array.isArray(frames) && typeof timing === "object") evidence.push({ id: this.id || this.getAttribute("aria-label") || "", frames, timing: timing || {} });
        return original.call(this, frames, timing);
      };
    });
    const dialog = await openSend(page, true);
    await dialog.getByTestId("send-amount").fill("1");
    const capsuleBackground = await page.locator("#mobile-nav-capsule").evaluate(element => getComputedStyle(element).background);
    expect(await page.locator("#sheet-bar-tint").evaluate(element => getComputedStyle(element).background)).toBe(capsuleBackground);
    await expect(dialog.getByTestId("send-review")).toBeEnabled();
    await page.waitForTimeout(950);
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("compose.png") });
    await dialog.getByTestId("send-review").click();
    await expect(page.locator("#sheet-review-header")).toContainText("Review");
    await page.waitForTimeout(650);
    const reviewBounds = await dialog.boundingBox();
    expect(reviewBounds!.height).toBeCloseTo(572, 0);
    expect(reviewBounds!.width).toBe(390);
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("review.png") });
    const evidence = await page.evaluate(() => (window as unknown as { arcMotion: { id: string; frames: Keyframe[]; timing: KeyframeAnimationOptions }[] }).arcMotion);
    expect(evidence.some(item => item.id === "sheet-card" && item.timing.duration === 480 && item.frames.some(frame => typeof frame.clipPath === "string"))).toBe(true);
    expect(evidence.some(item => item.id === "sheet-card" && item.timing.duration === 560 && item.frames[0].height !== item.frames[1].height)).toBe(true);
    const thumb = page.getByRole("button", { name: "Slide to send" });
    await expect(thumb).toBeEnabled();
    const thumbBounds = await thumb.boundingBox();
    expect(thumbBounds!.width).toBe(48);
    expect(thumbBounds!.height).toBe(48);
    const completedSwipe = await thumb.evaluate(element => Math.max(0, element.parentElement!.clientWidth - 58));
    const submission = page.waitForResponse(response => response.url().endsWith("/api/user/wallet/send") && response.request().method() === "POST");
    await thumb.press("Enter");
    await submission;
    await expect(page.getByTestId("wallet-summary").getByRole("img").first()).toHaveAttribute("aria-label", "100.00");
    const commitMotion = await page.evaluate(() => (window as unknown as { arcMotion: { id: string; frames: Keyframe[]; timing: KeyframeAnimationOptions }[] }).arcMotion);
    expect(commitMotion.some(item => item.id === "Slide to send" && item.timing.duration === 160 && item.frames[0].transform === `translateX(${completedSwipe}px) scale(1)`)).toBe(true);
    await expect(page.locator("#sheet-review-header").getByRole("button", { name: "Back" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Sent", exact: true })).toHaveText("Sent");
    expect(state.sent).toHaveLength(1);
    await expect(page.getByTestId("wallet-summary").getByRole("img").first()).toHaveAttribute("aria-label", "98.88");
    await page.waitForTimeout(850);
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("sent.png") });
    await dialog.getByRole("button", { name: "Done", exact: true }).dblclick();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#mobile-nav-capsule")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { arcMotion: { frames: Keyframe[]; timing: KeyframeAnimationOptions }[] }).arcMotion.some(item => item.timing.duration === 780 && item.timing.delay === 200 && item.frames[0].height === "0px" && item.frames[0].filter === "blur(8px)"))).toBe(true);
    await openSend(page, true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("pending send shows confirmation status and Done uses current receipt", async ({ browser }) => {
    const { page, context, state } = await fixture(browser, 390);
    state.pendingSend = true;
    const dialog = await openSend(page, true);
    await dialog.getByTestId("send-amount").fill("1");
    await dialog.getByTestId("send-review").click();
    await page.waitForTimeout(650);
    await expect(dialog.getByText("Transfer status", { exact: true })).toBeVisible();
    await expect(page.locator("#sheet-arrives-label")).toHaveText("Ready to send");
    await expect(page.getByRole("button", { name: "Slide to send" })).toBeEnabled();
    await page.getByRole("button", { name: "Slide to send" }).press("Space");
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(page.locator("#sheet-arrives-label")).toHaveText("Confirming…");
    state.confirmed = true;
    await expect(page.locator("#sheet-arrives-label")).toHaveText("Confirmed");
    await expect(page.getByTestId("wallet-summary").getByRole("img").first()).toHaveAttribute("aria-label", "98.88");
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("subscript_optimistic_txs") || "[]").every((row: { txHash: string; revealed: boolean }) => row.txHash && !row.revealed))).toBe(true);
    await expect(dialog.getByRole("link", { name: /View Receipt/ })).toHaveAttribute("href", new RegExp(hash));
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(state.sent).toHaveLength(1);
    await context.close();
  });

  for (const closeBeforeFailure of [false, true]) {
    test(`pending failure releases reservation ${closeBeforeFailure ? "after" : "before"} Done`, async ({ browser }) => {
      const { page, context, state } = await fixture(browser, 390);
      state.pendingSend = true;
      const dialog = await openSend(page, true);
      await dialog.getByTestId("send-amount").fill("1");
      await dialog.getByTestId("send-review").click();
      const thumb = page.getByRole("button", { name: "Slide to send" });
      await expect(thumb).toBeEnabled();
      await thumb.press("Enter");
      await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
      await expect(page.getByTestId("wallet-summary").getByRole("img").first()).toHaveAttribute("aria-label", "99.00");
      if (closeBeforeFailure) await dialog.getByRole("button", { name: "Done", exact: true }).click();
      state.failedPending = true;
      await expect(page.getByTestId("wallet-summary").getByRole("img").first()).toHaveAttribute("aria-label", "100.00");
      await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("subscript_optimistic_txs") || "[]").length)).toBe(0);
      if (!closeBeforeFailure) {
        await expect(page.locator("#sheet-arrives-label")).toHaveText("Failed");
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
      }
      await expect(dialog).toBeHidden();
      expect(state.sent).toHaveLength(1);
      await context.close();
    });
  }

  for (const firstStatus of ["confirmed", "failed"] as const) {
    for (const secondClosedStatus of ["pending", "failed"] as const) {
      test(`overlapping pending sends preserve first ${firstStatus} after second ${secondClosedStatus} Done`, async ({ browser }) => {
        const { page, context, state } = await fixture(browser, 390, 844, true, true);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        state.independentPending = true;
        for (const amount of ["1", "2"]) {
          const dialog = await openSend(page, true);
          await dialog.getByTestId("send-amount").fill(amount);
          await dialog.getByTestId("send-review").click();
          const thumb = page.getByRole("button", { name: "Slide to send" });
          await expect(thumb).toBeEnabled();
          await thumb.press("Enter");
          await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
          if (amount === "2" && secondClosedStatus === "failed") {
            state.pendingOperations.get("fixture-circle-2")!.status = "failed";
            await expect(page.locator("#sheet-arrives-label")).toHaveText("Failed");
          }
          await dialog.getByRole("button", { name: "Done", exact: true }).click();
          await expect(dialog).toBeHidden();
        }
        const balance = page.getByTestId("wallet-summary").getByRole("img").first();
        await expect(balance).toHaveAttribute("aria-label", secondClosedStatus === "pending" ? "97.00" : "99.00");
        state.pendingOperations.get("fixture-circle-1")!.status = firstStatus;
        await expect.poll(() => page.evaluate(() => {
          const rows = JSON.parse(sessionStorage.getItem("subscript_optimistic_txs") || "[]") as { txHash: string | null; amountUsdcMicros: string }[];
          return rows.some(row => row.amountUsdcMicros === "1000000" && !row.txHash);
        })).toBe(false);
        await expect(balance).toHaveAttribute("aria-label", firstStatus === "confirmed" ? (secondClosedStatus === "pending" ? "96.88" : "98.88") : (secondClosedStatus === "pending" ? "98.00" : "100.00"));
        if (secondClosedStatus === "pending") {
          state.pendingOperations.get("fixture-circle-2")!.status = "failed";
          await expect(balance).toHaveAttribute("aria-label", firstStatus === "confirmed" ? "98.88" : "100.00");
        }
        expect(state.sent).toHaveLength(2);
        expect(errors).toEqual([]);
        await context.close();
      });
    }
  }

  for (const reduced of [false, true]) {
    test(`mobile bottom navigation gracefully settles rapid tab selection${reduced ? " with reduced motion" : ""}`, async ({ browser }, info) => {
      const { page, context } = await fixture(browser, 390, 844, false, reduced);
      const nav = page.locator("#mobile-nav-capsule");
      const commit = nav.getByRole("button", { name: "Commit", exact: true });
      const widths = await commit.evaluate(element => new Promise<number[]>(resolve => {
        const samples: number[] = [];
        const started = performance.now();
        (element as HTMLButtonElement).click();
        const sample = () => {
          samples.push(element.getBoundingClientRect().width);
          if (performance.now() - started < 700) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      }));
      if (reduced) expect(widths.some(width => width > 37 && width < 89)).toBe(false);
      else expect(widths.some(width => width > 37 && width < 89)).toBe(true);
      await nav.getByRole("button", { name: "Links", exact: true }).evaluate(element => (element as HTMLButtonElement).click());
      const batch = nav.getByRole("button", { name: "Batch", exact: true });
      await batch.evaluate(element => (element as HTMLButtonElement).click());
      await expect(batch).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => batch.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(90);
      await expect(nav.locator('[aria-pressed="true"]')).toHaveCount(1);
      await page.screenshot({ style: "nextjs-portal { display:none!important; }", path: info.outputPath(`mobile-nav-${reduced ? "reduced" : "grace"}.png`) });
      await context.close();
    });
  }

  test("reduced motion suppresses flow movement and slider cancellation permits retry", async ({ browser }) => {
    const { page, context, state } = await fixture(browser, 390, 844, false, true);
    state.pendingSend = true;
    const dialog = await openSend(page, true);
    await dialog.getByTestId("send-amount").fill("1");
    await dialog.getByTestId("send-review").click();
    const thumb = page.getByRole("button", { name: "Slide to send" });
    await expect(thumb).toBeVisible();
    await expect(thumb).toBeEnabled();
    expect(await thumb.evaluate(element => getComputedStyle(element).animationDuration)).toBe("0.001s");
    const box = await thumb.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await thumb.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    await page.waitForTimeout(550);
    await expect(thumb).toHaveCSS("filter", "none");
    await thumb.press("Enter");
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    expect(await page.locator("#sheet-hero-wrapper circle").last().evaluate(element => element.getAnimations().some(animation => animation.effect?.getTiming().duration === 15000))).toBe(true);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(state.sent).toHaveLength(1);
    await context.close();
  });
  for (const width of [390, 1440]) {
    test(`${width}px Max reserves quoted gas and recent identities are unique`, async ({ browser }, info) => {
      const { page, context } = await fixture(browser, width);
      const dialog = await openSend(page, width < 768);
      await expect(dialog.getByTestId("send-gas-fee")).toContainText("0.125");
      await dialog.getByRole("button", { name: /^(Max|Send all-gas \(Max\))$/i }).click();
      await expect(dialog.getByTestId("send-amount")).toHaveValue("99.875");
      const recent = dialog.getByText("Recent recipients", { exact: true }).locator("..");
      await expect(recent.locator("button")).toHaveCount(1);
      await expect(recent).toContainText(/nora\.sub/i);
      await expect(dialog).not.toContainText("alice.sub");
      await expect(dialog.locator("img[src*='dicebear']")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: /Offramp.*Coming soon/i })).toBeDisabled();
      await expect(dialog).toContainText(/nora\.sub/i);
      await assertNoGutter(page);
      await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath(`send-compose-${width}.png`) });
      if (width < 768) {
        await dialog.getByTestId("send-review").click();
        await expect(page.locator("#sheet-review-header")).toContainText("Review");
        await expect(page.locator("#sheet-review-top")).toContainText("99.875");
        await expect(dialog.getByText("Network fee", { exact: true }).locator("..")).toContainText("0.125");
        await expect(dialog.getByText("Total received", { exact: true }).locator("..")).toContainText("99.875");
        await expect(dialog).toContainText("Wallet debit: 100 USDC");
        await page.waitForTimeout(650);
        await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("send-review-mobile.png") });
      }
      await context.close();
    });
  }

  test("failed transfers stay on review; successful Sent shows response and consistent title color", async ({ browser }, info) => {
    const { page, context, state } = await fixture(browser, 390);
    const dialog = await openSend(page, true);
    await dialog.getByTestId("send-amount").fill("25.375");
    await dialog.getByTestId("send-review").click();
    state.failSend = true;
    await slide(page);
    await expect(dialog).toContainText("Transfer rejected by test fixture");
    await expect(page.getByRole("heading", { name: /^S\s*e\s*n\s*t$/ })).toHaveCount(0);
    expect(state.sent).toHaveLength(1);
    state.failSend = false;
    state.receiptFeeMicros = 275_000n;
    await dialog.getByTestId("send-review").click();
    await slide(page);
    const sent = page.getByRole("heading", { name: /^S\s*e\s*n\s*t$/ });
    await expect(sent).toBeVisible({ timeout: 15_000 });
    await expect(sent).toHaveText("Sent");
    await expect(sent.locator("span")).toHaveCount(4);
    await expect(dialog.getByText("Done", { exact: true })).toHaveCSS("opacity", "1");
    await expect(dialog).toContainText("25.375 USDC");
    await expect(dialog.getByTestId("send-receipt-fee")).toContainText("0.275 USDC");
    await expect(dialog).toContainText("Wallet debit: 25.65 USDC");
    const colors = await sent.locator("span").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
    expect(new Set(colors).size).toBe(1);
    await expect(dialog.locator(`a[href*='${hash}']`)).toBeVisible();
    await assertNoGutter(page);
    await page.waitForTimeout(850);
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("send-sent-mobile.png") });
    await context.close();
  });

  test("320px mobile review and receipt remain reachable without horizontal overflow", async ({ browser }, info) => {
    const { page, context, state } = await fixture(browser, 320, 568);
    const dialog = await openSend(page, true);
    await dialog.getByTestId("send-amount").fill("1");
    await dialog.getByTestId("send-review").click();
    const thumb = dialog.getByRole("button", { name: "Slide to send" });
    await expect(thumb).toBeEnabled();
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toBeInViewport();
    await assertNoGutter(page);
    await thumb.press("Enter");
    const done = dialog.getByRole("button", { name: "Done", exact: true });
    await expect(done).toBeVisible();
    await done.scrollIntoViewIfNeeded();
    await expect(done).toBeInViewport();
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("compact-receipt.png") });
    await done.click();
    await expect(dialog).toBeHidden();
    expect(state.sent).toHaveLength(1);
    await context.close();
  });

  test("desktop retains its send form and actual receipt through failure and retry", async ({ browser }, info) => {
    const { page, context, state } = await fixture(browser, 1440);
    const dialog = await openSend(page, false);
    await dialog.getByTestId("send-amount").fill("2");
    const submit = dialog.getByRole("button", { name: "Send USDC", exact: true });
    await expect(submit).toBeEnabled();
    state.failSend = true;
    await submit.click();
    await expect(dialog).toContainText("Transfer rejected by test fixture");
    state.failSend = false;
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(dialog).toContainText("Wallet debit: 2.125 USDC");
    await expect(dialog.getByRole("link", { name: /View transaction/ })).toHaveAttribute("href", new RegExp(hash));
    expect(state.sent).toHaveLength(2);
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("desktop-receipt.png") });
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    await assertNoGutter(page);
    await context.close();
  });

  test("new users see no sample recipients and broken photos use the platform profile fallback", async ({ browser }) => {
    const { page, context, state } = await fixture(browser, 390, 844, true);
    state.brokenAvatar = true;
    const dialog = await openSend(page, true);
    await expect(dialog.getByText("Recent recipients", { exact: true })).toHaveCount(0);
    const recipientField = dialog.locator("input").first().locator("..");
    await expect(recipientField.locator('[aria-label="nora.sub"]')).toBeVisible();
    await expect(recipientField.locator("img")).toHaveCount(0);
    await dialog.getByTestId("send-amount").fill("1");
    await dialog.getByTestId("send-review").click();
    await expect(page.getByTestId("send-recipient-avatar").locator('[aria-label="nora.sub"]')).toBeVisible();
    await expect(page.locator("#sheet-review-top img[src*='fixture-missing-avatar']")).toHaveCount(0);
    await context.close();
  });

  for (const width of [390, 1440]) {
    test(`${width}px recipient resolution rejects stale responses`, async ({ browser }) => {
      const { page, context } = await fixture(browser, width);
      const secondAddress = `0x${"11".repeat(20)}`;
      await context.route("**/api/merchant/alias?alias=*", async (route) => {
        const alias = new URL(route.request().url()).searchParams.get("alias");
        await new Promise(resolve => setTimeout(resolve, alias === "first.sub" ? 1300 : 100));
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, alias, address: alias === "first.sub" ? recipient : secondAddress, profile_pic: null }) }).catch(() => {});
      });
      const dialog = await openSend(page, width < 768);
      await dialog.getByTestId("send-amount").fill("2");
      const field = dialog.locator("input").first();
      const oldRequest = page.waitForRequest(request => request.url().includes("alias=first.sub"));
      await field.fill("first.sub");
      await oldRequest;
      await field.fill("second.sub");
      const action = width < 768 ? dialog.getByTestId("send-review") : dialog.getByRole("button", { name: "Send USDC", exact: true });
      await expect(action).toBeDisabled();
      await expect(action).toBeEnabled();
      await page.waitForTimeout(1400);
      if (width < 768) {
        await action.click();
        await expect(page.locator("#sheet-review-top")).toContainText("second.sub");
        await expect(dialog.getByText("Address", { exact: true }).locator("..")).toContainText(/0x1111(?:…|\.\.\.)1111/);
      } else {
        await expect(field).toHaveValue("second.sub");
        await expect(dialog).toContainText("second.sub");
        await expect(dialog).toContainText(/0x1111(?:…|\.\.\.)1111/);
        await expect(dialog).not.toContainText("first.sub");
      }
      await context.close();
    });
  }

  test("rapid platform balance updates settle every digit without stale characters", async ({ browser }, info) => {
    const { page, context, state } = await fixture(browser, 390, 844, true);
    const amount = page.getByTestId("wallet-summary").getByRole("img").first();
    await expect(amount).toHaveAttribute("aria-label", "100.00");
    await page.evaluate(() => {
      const evidence: { frames: Keyframe[]; timing: number | KeyframeAnimationOptions | undefined }[] = [];
      (window as unknown as { digitAnimationEvidence: typeof evidence }).digitAnimationEvidence = evidence;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, timing) {
        if (this.parentElement?.classList.contains("roll-slot") && Array.isArray(frames)) evidence.push({ frames, timing });
        return original.call(this, frames, timing);
      };
    });
    for (const value of [99_250_000n, 8_000_000n, 12_345_670n]) {
      state.balanceMicros = value;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(amount).toHaveAttribute("aria-label", (Number(value) / 1_000_000).toFixed(2));
    }
    await page.waitForTimeout(1100);
    await expect(amount).toHaveText("12.35");
    expect(await amount.locator(".roll-leaving").count()).toBe(0);
    const settled = await amount.evaluate((element) => ({ label: element.getAttribute("aria-label"), text: element.textContent, animations: element.getAnimations({ subtree: true }).length }));
    expect(settled.text).toBe(settled.label);
    const animationEvidence = await page.evaluate(() => (window as unknown as { digitAnimationEvidence: { frames: Keyframe[]; timing: KeyframeAnimationOptions }[] }).digitAnimationEvidence);
    expect(animationEvidence.some(item => item.timing.duration === 540 && item.frames.some(frame => frame.filter === "blur(4px)"))).toBe(true);
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("balance-digits-settled.png") });
    await context.close();
  });

  test("network menu rows blur in with stagger and remain visible after scroll", async ({ browser }, info) => {
    const { page, context } = await fixture(browser, 390);
    const dialog = await openSend(page, true);
    await page.evaluate(() => {
      const recording: { id: string | null; timing: number | KeyframeAnimationOptions | undefined; frames: Keyframe[] }[] = [];
      (window as unknown as { networkAnimationEvidence: typeof recording }).networkAnimationEvidence = recording;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, timing) {
        if (this.getAttribute("role") === "option" && Array.isArray(frames)) recording.push({ id: this.getAttribute("data-testid"), timing, frames });
        return original.call(this, frames, timing);
      };
    });
    await dialog.getByRole("button", { name: /Arc.*(Testnet|Network)/ }).first().click();
    const menu = dialog.getByTestId("send-network-menu");
    await expect(menu).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { networkAnimationEvidence: unknown[] }).networkAnimationEvidence.length)).toBeGreaterThan(2);
    const timing = await page.evaluate(() => (window as unknown as { networkAnimationEvidence: { timing: KeyframeAnimationOptions; frames: Keyframe[] }[] }).networkAnimationEvidence);
    expect(timing.length).toBeGreaterThan(2);
    expect(timing.every((row) => row.timing.duration === 420 && row.frames.some((frame) => frame.filter === "blur(4px)"))).toBe(true);
    expect(new Set(timing.map((row) => row.timing.delay)).size).toBe(timing.length);
    await menu.locator("button").last().scrollIntoViewIfNeeded();
    await expect(menu.locator("button").last()).toBeInViewport();
    const lastId = await menu.locator("button").last().getAttribute("data-testid");
    await expect.poll(() => page.evaluate(id => (window as unknown as { networkAnimationEvidence: { id: string | null }[] }).networkAnimationEvidence.some(item => item.id === id), lastId)).toBe(true);
    await page.waitForTimeout(800);
    await expect(menu.locator("button").last()).toHaveCSS("filter", "none");
    await assertNoGutter(page);
    await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath("send-network-mobile.png") });
    await context.close();
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    test(`${viewport.width}px deposit steps share height and local bank remains coming soon`, async ({ browser }, info) => {
      const { page, context } = await fixture(browser, viewport.width, viewport.height);
      await page.getByTestId("wallet-actions").getByRole("button", { name: "Deposit", exact: true }).click();
      const dialog = page.locator("#deposit-sheet-card");
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(1000);
      const before = await dialog.boundingBox();
      await expect(dialog.getByRole("button", { name: /Local bank.*Coming soon/i })).toBeDisabled();
      await dialog.getByRole("button", { name: /Arc.*Native Arc/i }).click();
      await expect(dialog.locator("#deposit-sheet-title")).toContainText("Deposit via");
      await page.waitForTimeout(800);
      const after = await dialog.boundingBox();
      expect(after!.height).toBeCloseTo(before!.height, 0);
      const qr = dialog.locator("canvas");
      await qr.scrollIntoViewIfNeeded();
      expect((await qr.boundingBox())!.width).toBeGreaterThanOrEqual(viewport.width < 390 ? 200 : 230);
      await assertNoGutter(page);
      await page.screenshot({ style: "nextjs-portal { display: none !important; }", path: info.outputPath(`deposit-network-${viewport.width}.png`) });
      const copyAddress = dialog.getByRole("button", { name: "Copy deposit address" });
      await copyAddress.scrollIntoViewIfNeeded();
      await expect(copyAddress).toBeInViewport({ ratio: 1 });
      console.log(JSON.stringify({ viewport, sheetHeight: after!.height, qrWidth: (await qr.boundingBox())!.width, copyAddressVisible: true }));
      await dialog.getByRole("button", { name: "Back to networks", exact: true }).click();
      await expect(dialog.locator("#deposit-sheet-title")).toHaveText("Deposit USDC");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('nav[aria-label="Primary navigation"]')).toBeVisible();
      await context.close();
    });
  }
});
