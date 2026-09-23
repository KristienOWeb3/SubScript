import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("public positioning presents SubScript as a complete payment platform", () => {
  const answers = read("src/app/answers/page.tsx");
  const homepage = read("src/app/page.tsx");
  const compare = read("src/app/compare/page.tsx");

  assert.match(answers, /stablecoin payment infrastructure for global\s+businesses/);
  assert.match(answers, /checkout, recurring payments, usage-based\s+billing, sponsored payments, user-controlled authorization/);
  assert.match(homepage, /one-time, recurring, and pay-as-you-go USDC payments/);
  assert.match(compare, /USDC-native payment platform/);
});

test("general product surfaces do not position SubScript as subscription-only", () => {
  const files = [
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/signup/page.tsx",
    "src/app/compare/page.tsx",
    "src/app/answers/page.tsx",
    "src/app/protocol/page.tsx",
    "src/app/support/layout.tsx",
    "src/app/terms/layout.tsx",
  ];

  const copy = files.map(read).join("\n");
  const subscriptionOnlyLabels = [
    "subscription protocol",
    "subscription platform",
    "stablecoin subscriptions",
    "sponsored subscriptions",
    "subscription management",
    "metered subscription vaults",
  ];

  for (const label of subscriptionOnlyLabels) {
    assert.equal(copy.toLowerCase().includes(label), false, `found subscription-only label: ${label}`);
  }
});
