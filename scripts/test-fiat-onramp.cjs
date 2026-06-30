const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: "CommonJS",
  moduleResolution: "node",
  target: "ES2020",
});
require("ts-node/register/transpile-only");

const { getFiatOnrampConfig, requireSandboxConfig } = require("../src/lib/fiat-onramp/config.ts");
const { calculateQuote, parseNgnToKobo } = require("../src/lib/fiat-onramp/money.ts");
const {
  decideSimulation,
  deterministicSimulationEventId,
  resolveIdempotentCreate,
} = require("../src/lib/fiat-onramp/state.ts");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

assert.equal(parseNgnToKobo("1000.01"), 100001n);
assert.throws(() => parseNgnToKobo("1000.001"), /at most two decimal places/);
assert.throws(() => parseNgnToKobo(1000), /exact decimal string/);

assert.deepEqual(calculateQuote(1_000_000n, 160_000n), {
  grossUsdcMicros: 6_250_000n,
  feeFiatMinor: 0n,
  netUsdcMicros: 6_250_000n,
});
assert.equal(calculateQuote(100_001n, 160_000n).netUsdcMicros, 625_006n);

const sandboxConfig = getFiatOnrampConfig({
  FIAT_ONRAMP_MODE: "sandbox",
  FIAT_ONRAMP_NETWORK: "arc-testnet",
  FIAT_ONRAMP_CHAIN_ID: "5042002",
  FIAT_ONRAMP_MIN_NGN: "1000.00",
  FIAT_ONRAMP_MAX_NGN: "50000.00",
  FIAT_ONRAMP_QUOTE_RATE_NGN_PER_USDC: "1600.00",
  NEXT_PUBLIC_ENVIRONMENT: "testnet",
});
assert.equal(requireSandboxConfig(sandboxConfig).enabled, true);
assert.equal(getFiatOnrampConfig({ FIAT_ONRAMP_MODE: "live" }).enabled, false);
assert.equal(getFiatOnrampConfig({
  FIAT_ONRAMP_MODE: "sandbox",
  FIAT_ONRAMP_CHAIN_ID: "5042002",
  NEXT_PUBLIC_ENVIRONMENT: "testnet",
}).enabled, false);
assert.equal(getFiatOnrampConfig({
  FIAT_ONRAMP_MODE: "sandbox",
  FIAT_ONRAMP_NETWORK: "production",
  FIAT_ONRAMP_CHAIN_ID: "5042002",
  NEXT_PUBLIC_ENVIRONMENT: "testnet",
}).enabled, false);
assert.equal(getFiatOnrampConfig({
  FIAT_ONRAMP_MODE: "sandbox",
  FIAT_ONRAMP_NETWORK: "arc-testnet",
  FIAT_ONRAMP_CHAIN_ID: "5042002",
  NEXT_PUBLIC_ENVIRONMENT: "mainnet",
}).enabled, false);

assert.equal(resolveIdempotentCreate(100_000n, 100_000n), "replay");
assert.throws(() => resolveIdempotentCreate(100_000n, 200_000n), /different amount/);
assert.equal(
  decideSimulation("AWAITING_TRANSFER", new Date("2030-01-01"), new Date("2029-01-01")),
  "transition",
);
assert.equal(
  decideSimulation("SIMULATED_SETTLED", new Date("2030-01-01"), new Date("2029-01-01")),
  "replay",
);
assert.throws(
  () => decideSimulation("AWAITING_TRANSFER", new Date("2029-01-01"), new Date("2030-01-01")),
  /expired/,
);
assert.equal(
  deterministicSimulationEventId("11111111-1111-1111-1111-111111111111"),
  "subscript-sandbox:settled:11111111-1111-1111-1111-111111111111",
);

const serviceSource = read("src/lib/fiat-onramp/service.ts");
assert.match(serviceSource, /prisma\.\$transaction/);
assert.match(serviceSource, /fiatFundingIntent\.updateMany/);
assert.match(serviceSource, /deterministicSimulationEventId/);
assert.match(serviceSource, /transition\.count === 1/);

const migrationSource = read("supabase/migrations/20260703000000_create_fiat_funding_intents.sql");
assert.match(migrationSource, /UNIQUE \(wallet_address, idempotency_key\)/);
assert.match(migrationSource, /ENABLE ROW LEVEL SECURITY/);
assert.match(migrationSource, /REVOKE ALL PRIVILEGES[\s\S]*FROM anon, authenticated/);
assert.match(migrationSource, /fiat_funding_intents_status_valid/);
assert.match(migrationSource, /fiat_funding_intents_one_active_per_wallet_idx/);
assert.doesNotMatch(migrationSource, /FORCE ROW LEVEL SECURITY/);

const uiSource = read("src/app/dashboard/user/page.tsx").toLowerCase();
for (const banned of ["moonpay", "transak", "stripe", "3ds"]) {
  assert.equal(uiSource.includes(banned), false, `customer dashboard still contains ${banned}`);
}
assert.match(uiSource, /settlement gas is paid separately/);
assert.match(uiSource, /\/api\/user\/funding-intents/);
assert.match(uiSource, /no card required/);

console.log("fiat-onramp verification passed");
