const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: "CommonJS",
  moduleResolution: "node",
  target: "ES2020",
});
require("ts-node/register/transpile-only");

const { getFiatOnrampConfig } = require("../src/lib/fiat-onramp/config.ts");
const { fundingUnavailableResponse } = require("../src/lib/fiat-onramp/route.ts");

const root = path.resolve(__dirname, "..");
const absolute = (relativePath) => path.join(root, relativePath);
const read = (relativePath) => fs.readFileSync(absolute(relativePath), "utf8");

for (const env of [
  {},
  { FIAT_ONRAMP_MODE: "live" },
  {
    FIAT_ONRAMP_MODE: "sandbox",
    FIAT_ONRAMP_NETWORK: "arc-testnet",
    FIAT_ONRAMP_CHAIN_ID: "5042002",
  },
]) {
  const config = getFiatOnrampConfig(env);
  assert.equal(config.enabled, false);
  assert.equal(config.mode, "disabled");
  assert.match(config.unavailableReason, /licensed live funding provider/i);
}

const rootFundingRoute = read("src/app/api/user/funding-intents/route.ts");
assert.match(rootFundingRoute, /fundingUnavailableResponse/);
assert.match(rootFundingRoute, /export function GET/);
assert.match(rootFundingRoute, /export function POST/);

const fundingItemRoute = read("src/app/api/user/funding-intents/[id]/route.ts");
assert.match(fundingItemRoute, /fundingUnavailableResponse/);

assert.equal(
  fs.existsSync(absolute("src/app/api/user/funding-intents/[id]/simulate/route.ts")),
  false,
  "simulation API must not be deployed",
);
assert.equal(
  fs.existsSync(absolute("src/app/api/auth/social/route.ts")),
  false,
  "unverified social auth API must not be deployed",
);

const dashboardSource = [
  read("src/app/dashboard/page.tsx"),
  read("src/app/dashboard/user/page.tsx"),
].join("\n");
for (const unsafeSurface of [
  "/api/auth/social",
  "/api/user/funding-intents",
  'activeSubMode === "fiat"',
  'setActiveSubMode("fiat")',
  "FiatFundingIntentView",
  "handleSimulateBankTransfer",
  "Get bank details",
  "Simulate bank transfer received",
  "Fake account number",
]) {
  assert.equal(
    dashboardSource.includes(unsafeSurface),
    false,
    `dashboard still exposes unsafe surface: ${unsafeSurface}`,
  );
}

const middlewareSource = read("src/middleware.ts");
assert.equal(middlewareSource.includes("/api/auth/social"), false);

const otpSource = [
  read("src/app/api/auth/otp/send/route.ts"),
  read("src/app/api/auth/otp/verify/route.ts"),
  read("src/app/signin/page.tsx"),
  read("src/app/signup/page.tsx"),
  read("src/app/dashboard/page.tsx"),
].join("\n");
for (const unsafeOtpFallback of [
  "sandboxCode",
  "Sandbox Test OTP",
  "ALLOW_INSECURE_OFFLINE_AUTH",
  "saveOfflineOtpCode",
  "getOfflineOtpCode",
]) {
  assert.equal(
    otpSource.includes(unsafeOtpFallback),
    false,
    `email OTP still contains an unsafe fallback: ${unsafeOtpFallback}`,
  );
}

fundingUnavailableResponse().json().then((body) => {
  assert.equal(body.code, "FIAT_ONRAMP_UNAVAILABLE");
  assert.match(body.error, /licensed live funding provider/i);
  assert.equal(fundingUnavailableResponse().status, 503);
  console.log("live-surface fail-closed verification passed");
});
