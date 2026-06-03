const hre = require("hardhat");
const { createClient } = require("c:/Users/Kristien/OneDrive/Desktop/SubScript/node_modules/@supabase/supabase-js");
require("c:/Users/Kristien/OneDrive/Desktop/SubScript/node_modules/dotenv").config({ path: "c:/Users/Kristien/OneDrive/Desktop/SubScript/.env.local" });

const PROXY_ADDRESS = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
const TREASURY = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";
const USDC = "0x3600000000000000000000000000000000000000";

async function assert(condition, message) {
  if (!condition) {
    throw new Error(`CHECK FAILED: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

async function main() {
  const [signer] = await hre.ethers.getSigners();

  console.log("\n=== ZERO FAILURE UPGRADE CHECK START ===\n");

  /* -----------------------------
   * 1. OWNERSHIP CHECK
   * ----------------------------- */
  const routerAbi = [
    "function owner() view returns (address)",
    "function paymentToken() view returns (address)",
    "function treasury() view returns (address)",
    "function merchantBalances(address merchant) view returns (uint256)"
  ];
  const router = new hre.ethers.Contract(PROXY_ADDRESS, routerAbi, signer);
  const owner = await router.owner();

  await assert(
    owner.toLowerCase() === signer.address.toLowerCase(),
    `Signer is NOT proxy owner. Owner=${owner}, Signer=${signer.address}`
  );

  /* -----------------------------
   * 2. USDC BALANCE CHECK
   * ----------------------------- */
  const erc20Abi = [
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];
  const usdc = new hre.ethers.Contract(USDC, erc20Abi, signer);
  const balance = await usdc.balanceOf(PROXY_ADDRESS);

  console.log(`Router USDC balance: ${hre.ethers.formatUnits(balance, 6)} USDC`);

  await assert(
    balance > 0n,
    "Router balance is zero — nothing to rescue"
  );

  /* -----------------------------
   * 3. MERCHANT LIABILITY CHECK
   * ----------------------------- */
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: merchants, error: merchantErr } = await supabase
    .from("merchants")
    .select("wallet_address");

  if (merchantErr) {
    throw new Error(`Failed to query merchants from database: ${merchantErr.message}`);
  }

  let sumBalances = 0n;
  for (const m of merchants) {
    const bal = await router.merchantBalances(m.wallet_address);
    if (bal > 0n) {
      console.log(`Merchant ${m.wallet_address} balance on-chain: ${hre.ethers.formatUnits(bal, 6)} USDC`);
      sumBalances += bal;
    }
  }

  console.log(`Sum of all merchant balances on-chain: ${hre.ethers.formatUnits(sumBalances, 6)} USDC`);
  await assert(
    sumBalances === 0n,
    "Merchant liabilities exist in the router contract. Draining funds is unsafe."
  );

  /* -----------------------------
   * 4. PENDING / PROCESSING DB SESSIONS CHECK (Active / Non-expired only)
   * ----------------------------- */
  const { data: pendingSessions, error: sessionErr } = await supabase
    .from("payment_sessions")
    .select("session_id, status, expires_at")
    .in("status", ["PENDING", "PROCESSING"])
    .gt("expires_at", new Date().toISOString());

  if (sessionErr) {
    throw new Error(`Failed to query payment sessions: ${sessionErr.message}`);
  }

  console.log(`Active non-expired pending/processing payment sessions in database: ${pendingSessions.length}`);
  if (pendingSessions.length > 0) {
    console.log("Active pending sessions found:", pendingSessions);
  }

  await assert(
    pendingSessions.length === 0,
    "Active non-expired pending/processing sessions exist. Wait for them to settle/expire before upgrading."
  );

  /* -----------------------------
   * 5. POST-UPGRADE READINESS CHECK
   * ----------------------------- */
  await assert(
    hre.ethers.isAddress(TREASURY),
    "Treasury address is invalid"
  );

  await assert(
    USDC !== hre.ethers.ZeroAddress,
    "USDC address is invalid"
  );

  console.log("\n=== FINAL SAFETY SNAPSHOT ===");
  console.log("Proxy:", PROXY_ADDRESS);
  console.log("Owner:", owner);
  console.log("Balance:", hre.ethers.formatUnits(balance, 6));
  console.log("Treasury:", TREASURY);

  console.log("\n=== ZERO FAILURE CHECK COMPLETE ===\n");
}

main().catch((err) => {
  console.error("\nHARD STOP:", err.message);
  process.exit(1);
});
