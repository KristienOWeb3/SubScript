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

test("a longer hex run is refused rather than truncated to a wrong address", () => {
    /* An unanchored 40-digit match returned the first 40 digits of a 41-digit run — a 42-character
       string that ethers.isAddress accepts, and not the address in the code. It reached the Send
       dialog as a prefilled recipient, so this had to fail closed rather than guess. */
    const tooLong = `${ADDRESS}0`;
    assert.deepEqual(resolveScannedTarget(tooLong), { kind: "text", value: tooLong });
    assert.equal(parseScannedAddress(tooLong), tooLong, "returns input unchanged, not a prefix");

    assert.equal(resolveScannedTarget(`0x${"a".repeat(41)}`).kind, "text");
    assert.equal(resolveScannedTarget(`ethereum:${ADDRESS}0`).kind, "text");
    assert.equal(resolveScannedTarget(`text ${ADDRESS}0 more`).kind, "text");
});

test("a complete address still matches when surrounded by other text", () => {
    assert.deepEqual(resolveScannedTarget(`pay ${ADDRESS} now`), { kind: "address", address: ADDRESS });
    assert.deepEqual(resolveScannedTarget(`${ADDRESS}!`), { kind: "address", address: ADDRESS });
});

test("the link allow-list cannot be walked out of", () => {
    /* Each of these is either not a link at all, or reduced to a path this app serves. None may
       come back as something that would navigate off-origin or above the matched route. */
    const mustNotBeLinks = [
        "//evil.example/pay/abc",
        "javascript:alert(1)//pay/x",
        "/pay/abc/../../admin",
        "https://www.subscriptonarc.com/docs/webhooks",
    ];
    for (const input of mustNotBeLinks) {
        assert.notEqual(resolveScannedTarget(input).kind, "link", `${input} must not resolve to a link`);
    }

    /* Credentials, fragments and foreign hosts are all discarded down to the path. */
    assert.deepEqual(resolveScannedTarget("https://user:pass@evil.example/pay/abc"), {
        kind: "link",
        path: "/pay/abc",
    });
    assert.deepEqual(resolveScannedTarget("https://x.com/pay/abc#@evil.example"), {
        kind: "link",
        path: "/pay/abc",
    });
});

test("an encoded separator is refused, not passed through as one segment", () => {
    /* `[^/]+` matched a percent-encoded slash happily, so `/pay/..%2F..%2Fadmin` looked like a
       single-segment id. Whether that stays one segment or gets normalised into two depends on the
       router's URL handling, which is not something to rest a boundary on across an upgrade — so the
       resolver refuses it outright instead of handing it on and hoping. */
    for (const encoded of ["%2F", "%2f", "%5C", "%5c"]) {
        const viaUrl = resolveScannedTarget(`https://x.com/pay/..${encoded}..${encoded}admin`);
        assert.equal(viaUrl.kind, "text", `encoded separator ${encoded} must not resolve to a link`);

        const viaPath = resolveScannedTarget(`/dm/invite/tok${encoded}evil`);
        assert.equal(viaPath.kind, "text", `encoded separator ${encoded} must not resolve on a bare path`);
    }

    /* Percent-encoding has no legitimate use in these parameters, so any of it is refused. */
    assert.equal(resolveScannedTarget("https://x.com/pay/%2e%2e%2fadmin").kind, "text");
});

test("a traversal parameter is refused even though its characters are unreserved", () => {
    assert.equal(resolveScannedTarget("https://x.com/pay/..").kind, "text");
    assert.equal(resolveScannedTarget("https://x.com/pay/.").kind, "text");
    assert.equal(resolveScannedTarget("/pay/..").kind, "text");
});

test("a route needs exactly its own parameter count", () => {
    /* Neither a missing parameter nor an extra segment is the route it resembles. */
    assert.equal(resolveScannedTarget("https://x.com/pay").kind, "text");
    assert.equal(resolveScannedTarget("https://x.com/pay/abc/extra").kind, "text");
    assert.equal(resolveScannedTarget("https://x.com/dm/invite").kind, "text");
    assert.deepEqual(resolveScannedTarget("https://x.com/dm/invite/tok"), {
        kind: "link",
        path: "/dm/invite/tok",
    });
});
