import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Arc CCTP is enabled and pinned to the verified mainnet domain", async () => {
  const constants = await source("src/lib/contracts/constants.ts");

  /* Mainnet CCTP is intentionally enabled (Circle's Arc addresses verified). The real safety net is
     no longer a blanket gate but the per-route gas fail-closed check; the entry-point guards below
     still exist so the flag can be flipped back off in one line if needed. */
  assert.match(constants, /export const ARC_CCTP_ENABLED = true/);
  assert.match(constants, /export const ARC_CCTP_DOMAIN_ID = 26 as const/);
});

test("money-moving CCTP routes reject mainnet before side effects", async () => {
  const routePaths = [
    "src/app/api/user/cctp/deposit/route.ts",
    "src/app/api/user/cctp/intent/route.ts",
    "src/app/api/user/cctp/withdraw/route.ts",
    "src/app/api/user/cctp/withdraw/register/route.ts",
    "src/app/api/user/cctp/scan/route.ts",
    "src/app/api/keeper/cctp/route.ts",
  ];

  for (const routePath of routePaths) {
    const route = await source(routePath);
    const gate = route.indexOf("if (!ARC_CCTP_ENABLED)");
    assert.ok(gate >= 0, routePath + " must check ARC_CCTP_ENABLED");
    assert.match(route.slice(gate, gate + 220), /status: 503/);

    const sideEffects = [
      route.indexOf("await getSessionWallet"),
      route.indexOf("await req.json"),
      route.indexOf("await processPendingCctpTransfers"),
      route.indexOf("void sweepAndBridge"),
    ].filter((index) => index >= 0);

    assert.ok(
      sideEffects.every((index) => gate < index),
      routePath + " must gate CCTP before authentication, payload parsing, or transfer work",
    );
  }
});

test("CCTP workers reject mainnet before database or network access", async () => {
  const workers = [
    ["src/lib/cctp/autoBridge.ts", "export async function sweepAndBridge", "pgQuery"],
    ["src/lib/cctp/attestationWorker.ts", "export async function processPendingCctpTransfers", "pgQuery"],
    ["src/lib/cctp/crossChainScanner.ts", "export async function scanCrossChainBalances", "resolveRpcUrl"],
    ["src/lib/cctp/crossChainScanner.ts", "export async function detectAndNotifyInboundCctp", "pgMaybeOne"],
    ["src/lib/cctp/crossChainScanner.ts", "export async function scanDerivedDepositAddresses", "pgQuery"],
    ["src/lib/cctp/solanaRelayer.ts", "export async function relayCctpMintToSolana", "getSolanaConnection"],
  ];

  for (const [path, functionName, firstSideEffect] of workers) {
    const worker = await source(path);
    const start = worker.indexOf(functionName);
    assert.ok(start >= 0, path + " must expose " + functionName);
    const body = worker.slice(start);
    const gate = body.indexOf("assertArcCctpAvailable()");
    const sideEffect = body.indexOf(firstSideEffect);
    assert.ok(gate >= 0, functionName + " must assert CCTP availability");
    assert.ok(sideEffect >= 0 && gate < sideEffect, functionName + " must gate before " + firstSideEffect);
  }
});

test("mainnet UI disables cross-chain routes and skips CCTP probes", async () => {
  const [fees, depositModal, dashboard] = await Promise.all([
    source("src/lib/cctp/feeEngine.ts"),
    source("src/components/DepositModal.tsx"),
    source("src/app/dashboard/user/page.tsx"),
  ]);

  assert.match(fees, /available: ARC_CCTP_ENABLED && allowed !== false/);
  assert.match(depositModal, /ARC_CCTP_ENABLED \? Object\.entries\(CCTP_CONFIG\) : \[\]/);
  assert.match(dashboard, /ARC_CCTP_ENABLED \? fetch\("\/api\/user\/cctp\/scan"\)/);
  assert.match(dashboard, /\(ARC_CCTP_ENABLED \? Object\.entries\(CCTP_CONFIG\) : \[\]\)/);
});

