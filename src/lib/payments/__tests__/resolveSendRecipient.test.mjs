import test from "node:test";
import assert from "node:assert/strict";
import { resolveSendRecipient } from "../resolveSendRecipient.ts";

const address = `0x${"12".repeat(20)}`;
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("a successful .sub lookup validates the destination and preserves account metadata", async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/merchant/alias?alias=nora.sub");
    return Response.json({ success: true, address, alias: "nora.sub", profile_pic: "/avatar.png" });
  };
  assert.deepEqual(await resolveSendRecipient("Nora.sub", new AbortController().signal), { address, alias: "nora.sub", profilePic: "/avatar.png", hasAccount: true });
});

test("non-OK lookup responses cannot enable sending even if their body claims success", async () => {
  globalThis.fetch = async () => Response.json({ success: true, address }, { status: 503 });
  await assert.rejects(resolveSendRecipient("nora.sub", new AbortController().signal), /unavailable/);
});

test("unknown and malformed destinations provide actionable errors", async () => {
  for (const data of [{ success: false }, { success: true, address: "invalid" }]) {
    globalThis.fetch = async () => Response.json(data);
    await assert.rejects(resolveSendRecipient("nora.sub", new AbortController().signal), /could not be found/);
  }
  await assert.rejects(resolveSendRecipient("merc_not_a_destination", new AbortController().signal), /wallet address or a \.sub name/);
});

test("network and invalid-JSON failures surface a safe lookup error", async () => {
  for (const fetchImpl of [async () => { throw new TypeError("Failed to fetch"); }, async () => new Response("not JSON")]) {
    globalThis.fetch = fetchImpl;
    await assert.rejects(resolveSendRecipient("nora.sub", new AbortController().signal), /unavailable/);
  }
});

test("a stalled lookup aborts and can be retried successfully", async () => {
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await assert.rejects(resolveSendRecipient("nora.sub", new AbortController().signal, 5), /took too long/);
  globalThis.fetch = async () => Response.json({ success: true, address });
  assert.equal((await resolveSendRecipient("nora.sub", new AbortController().signal)).address, address);
});

test("cancelled or stale requests cannot return a successful target", async () => {
  const controller = new AbortController();
  globalThis.fetch = async () => {
    controller.abort();
    return Response.json({ success: true, address });
  };
  await assert.rejects(resolveSendRecipient("nora.sub", controller.signal), /cancelled/);
});

test("a valid wallet address remains usable when optional metadata lookup fails", async () => {
  globalThis.fetch = async () => Response.json({ error: "Unavailable" }, { status: 503 });
  assert.deepEqual(await resolveSendRecipient(address, new AbortController().signal), { address, alias: null, profilePic: null, hasAccount: false });
});
