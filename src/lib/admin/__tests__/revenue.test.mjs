import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS, SUBSCRIPT_PROTOCOL_FEE_BPS } from "../../contracts/constants.js";
import { formatFeeBps } from "../../cctp/feeEngine.js";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const ROUTE = "src/app/api/admin/revenue/route.ts";
const VIEW = "src/components/admin/AdminRevenueView.tsx";
const ADMIN_PAGE = "src/app/admin/page.tsx";

test("platform revenue is root-only and cannot be reached with a delegated scope", () => {
  const route = source(ROUTE);

  /* requireRootAdmin, not requireScope. A delegated admin holding `finance` operates the ledger but
     must not see the whole P&L; scoping this to a capability would hand it to them. */
  assert.match(route, /requireRootAdmin\(request\)/);
  assert.doesNotMatch(route, /requireScope\(/);
  assert.doesNotMatch(route, /requireAnyScope\(/);
  /* Bare requireAdmin would admit every tier including read-only. */
  assert.doesNotMatch(route, /await requireAdmin\(/);
});

test("the revenue tab is hidden from non-root admins on every navigation surface", () => {
  const page = source(ADMIN_PAGE);

  /* Sidebar (desktop) and the tab strip (mobile) are separate lists built from separate sources, so
     gating one and forgetting the other leaves the tab reachable. */
  assert.match(page, /\.\.\.\(viewerIsRoot \? \[\{ id: "revenue"/);
  assert.match(page, /TABS\.filter\(\(t\) => !t\.rootOnly \|\| viewerIsRoot\)/);
  assert.match(page, /\{ id: "revenue", label: "Revenue", rootOnly: true \}/);
});

test("revenue counts premium payments once, not also as a 1% cut of themselves", () => {
  const route = source(ROUTE);

  /* Premium receipts are addressed to us, so the whole amount is income. Leaving them in the
     protocol-fee base would additionally bill 1% of our own revenue to ourselves. */
  assert.match(route, /merchantAddress: \{ not: premiumRecipient \}/);
  assert.match(route, /merchantAddress: premiumRecipient/);
  assert.ok(PREMIUM_PAYMENT_RECIPIENT_ADDRESS.startsWith("0x"));
});

test("the protocol fee rate comes from config, not a hardcoded divisor", () => {
  const route = source(ROUTE);

  /* The existing financials route hardcodes `/ 100n`. If the platform rate ever moves off 100 bps
     that silently keeps reporting 1%, so this one multiplies by the configured bps instead. */
  assert.match(route, /BigInt\(SUBSCRIPT_PROTOCOL_FEE_BPS\)\) \/ 10_000n/);
  assert.doesNotMatch(route, /Micros \/ 100n/);
  assert.equal(SUBSCRIPT_PROTOCOL_FEE_BPS, 100);
  assert.equal(formatFeeBps(SUBSCRIPT_PROTOCOL_FEE_BPS), "1.0%");
});

test("bridge revenue is read from collected fees, not from completed transfers", () => {
  const route = source(ROUTE);

  /* The fee is transferred to the treasury before the CCTP burn, so a transfer still waiting on
     Circle has already paid us. Filtering on status = 'completed' would under-report every transfer
     in flight. */
  assert.match(route, /WHERE fee_tx_hash IS NOT NULL/);
  assert.doesNotMatch(route, /status = 'completed'/);
});

test("the bridge rollup avoids reserved words and sorts numerically", () => {
  const route = source(ROUTE);

  /* `window` is a reserved word in Postgres and would need quoting as a column alias. */
  assert.doesNotMatch(route, /AS w\(window,/);
  assert.match(route, /AS w\(bucket, span\)/);

  /* fee_micros is cast to text for transport, so ordering by it would sort lexicographically and
     put 9 above 10. */
  assert.match(route, /ORDER BY SUM\(fee_amount_micros\) DESC/);
  assert.doesNotMatch(route, /ORDER BY 4 DESC/);
});

test("every fee surface is listed, including the ones not earning yet", () => {
  const route = source(ROUTE);
  const view = source(VIEW);

  for (const id of ["merchant_fees", "premium_plans", "bridge_fees", "bank_rails"]) {
    assert.match(route, new RegExp(`id: "${id}"`), `${id} missing from the revenue sources`);
  }

  /* Bank rails are structurally zero rather than omitted, and the table says so, so the total reads
     as the whole fee surface instead of only the live parts. */
  assert.match(route, /live: false/);
  assert.match(view, /Not live/);

  /* A grand total across sources, which is the number the page exists to answer. */
  assert.match(route, /merchantFee\[w\] \+ premiumRevenue\[w\] \+ bridgeFee\[w\] \+ bankFee\[w\]/);
  assert.match(view, /Total revenue/);
});

test("revenue amounts are formatted from integer micros, never floats", () => {
  const route = source(ROUTE);

  /* USDC amounts are 6-decimal integers. Dividing into a Number loses cents at scale, which is why
     formatUsdc works in bigint and slices the fraction as a string. */
  assert.match(route, /const MICRO_USDC = 1_000_000n;/);
  assert.doesNotMatch(route, /Number\([a-zA-Z]+Micros\) \/ 1_000_000/);
});

test("the login fork no longer carries a Google button that belongs to neither choice", () => {
  const login = source("src/app/login/page.tsx");
  const signin = source("src/app/signin/page.tsx");
  const signup = source("src/app/signup/page.tsx");

  /* It sat above both options without belonging to either. Both destinations still have one, so the
     capability is intact where the intent is already settled. */
  assert.doesNotMatch(login, /CircleGoogleWalletButton/);
  assert.match(signin, /<CircleGoogleWalletButton/);
  assert.match(signup, /<CircleGoogleWalletButton/);
});
