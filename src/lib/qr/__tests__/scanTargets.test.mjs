import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScannedAddress, resolveScannedTarget } from "../scanTargets.ts";

const ADDRESS = "0x497b0e2c08fb93464354e7023f040e088b169a3f";

test("a DM invite link resolves to a link, not a recipient address", () => {
    /* The reported bug: scanning an invite pasted the whole URL into the address field. */
    const target = resolveScannedTarget("https://www.subscriptonarc.com/dm/invite/abc123token");
    assert.deepEqual(target, { kind: "link", path: "/dm/invite/abc123token" });
});

test("a commit link survives even though its path contains an address", () => {
    /* The old shared parser looked for a bare 0x first, so this became a payment to the merchant
       rather than an invitation to open their commit page. */
    const target = resolveScannedTarget(`https://www.subscriptonarc.com/commit/${ADDRESS}`);
    assert.deepEqual(target, { kind: "link", path: `/commit/${ADDRESS}` });
});

test("payment, receipt and subscribe links all route", () => {
    assert.equal(resolveScannedTarget("https://www.subscriptonarc.com/pay/abc").kind, "link");
    assert.equal(resolveScannedTarget("https://www.subscriptonarc.com/receipt/rcpt-1").kind, "link");
    assert.equal(resolveScannedTarget("https://www.subscriptonarc.com/subscribe/9").kind, "link");
});

test("query strings are preserved", () => {
    const target = resolveScannedTarget("https://www.subscriptonarc.com/pay/abc?ref=twitter");
    assert.deepEqual(target, { kind: "link", path: "/pay/abc?ref=twitter" });
});

test("a hostile host is discarded rather than followed", () => {
    /* A QR code is an instruction from a stranger. Following the host it names would let an
       attacker put a convincing fake checkout on a domain we do not control, so only the path
       survives and it is re-based on our own origin by the caller. */
    const target = resolveScannedTarget("https://not-subscript.example/pay/abc");
    assert.deepEqual(target, { kind: "link", path: "/pay/abc" });
});

test("an unrecognised path on any host is not treated as a link", () => {
    assert.equal(resolveScannedTarget("https://www.subscriptonarc.com/docs/webhooks").kind, "text");
    assert.equal(resolveScannedTarget("https://evil.example/login").kind, "text");
});

test("a trailing slash does not defeat matching, and is normalised away", () => {
    assert.deepEqual(resolveScannedTarget("https://www.subscriptonarc.com/pay/abc/"), {
        kind: "link",
        path: "/pay/abc",
    });
});

test("a bare origin-relative path routes", () => {
    assert.deepEqual(resolveScannedTarget("/dm/invite/tok"), { kind: "link", path: "/dm/invite/tok" });
});

test("a bare address is an address", () => {
    assert.deepEqual(resolveScannedTarget(ADDRESS), { kind: "address", address: ADDRESS });
});

test("EIP-681 is an address", () => {
    assert.deepEqual(resolveScannedTarget(`ethereum:${ADDRESS}@5042002`), {
        kind: "address",
        address: ADDRESS,
    });
});

test("a handle falls through to text for the recipient box to resolve", () => {
    assert.deepEqual(resolveScannedTarget("kristien.arc"), { kind: "text", value: "kristien.arc" });
});

test("empty input is text, not a crash", () => {
    assert.deepEqual(resolveScannedTarget("   "), { kind: "text", value: "" });
});

test("parseScannedAddress unwraps the wallet-app formats", () => {
    assert.equal(parseScannedAddress(`ethereum:${ADDRESS}?value=1`), ADDRESS);
    assert.equal(parseScannedAddress(`https://example.com/pay?address=${ADDRESS}`), ADDRESS);
    assert.equal(parseScannedAddress(`  ${ADDRESS}  `), ADDRESS);
});

test("parseScannedAddress hands back a handle untouched so aliases still resolve", () => {
    assert.equal(parseScannedAddress("kristien.arc"), "kristien.arc");
});
