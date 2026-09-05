import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readRepoFile(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

describe("CCTP Deposit Finalization & Non-Conflicting Routing Statuses", () => {
  it("prioritizes query paramAddress over sessionWallet in CCTP balance scanner", () => {
    const scanRoute = readRepoFile("src/app/api/user/cctp/scan/route.ts");
    assert.match(
      scanRoute,
      /const targetWallet = \(paramAddress \|\| sessionWallet \|\| ""\)/,
      "scan route must prioritize paramAddress over sessionWallet so derived routers are not shadowed by connected wallets",
    );
  });

  it("isolates deposit intents and suppresses conflicting 'detected' state when bridging or completed", () => {
    const modal = readRepoFile("src/components/DepositModal.tsx");

    assert.match(modal, /activeIntentId/, "modal must maintain activeIntentId state");
    assert.match(modal, /setActiveIntentId\(data\.intentId \|\| null\)/, "modal must store intentId returned from intent registration");
    assert.match(modal, /isAlreadyBridgingOrDone/, "modal must guard against setting 'detected' when deposit is already bridging or completed");
    assert.match(modal, /setOriginBalance\("0\.00"\)/, "modal must set originBalance to 0.00 when bridgeStatus is completed");
    assert.match(modal, /Deposit confirmed on Arc/, "network pill must indicate 'Deposit confirmed on Arc' when completed");
    assert.match(modal, /bridgeStatus === "completed" \? "0\.00" : originBalance/, "origin balance display must show 0.00 USDC when bridgeStatus is completed");
  });

  it("prevents BalanceRoutingNotice from displaying when single send has confirmed or succeeded", () => {
    const sendSingleModal = readRepoFile("src/components/SendSingleModal.tsx");
    assert.match(
      sendSingleModal,
      /isArcRoute && !status\?\.startsWith\("Sent"\) && !status\?\.startsWith\("Success"\) && routingNotice/,
      "SendSingleModal must hide routingNotice when transfer status has confirmed or succeeded",
    );
  });

  it("prevents BalanceRoutingNotice from displaying when send funds modal or batch send has succeeded", () => {
    const userPage = readRepoFile("src/app/dashboard/user/page.tsx");
    
    assert.match(
      userPage,
      /\{status !== "success" && \(\s*<BalanceRoutingNotice/,
      "SendFundsModal must not render BalanceRoutingNotice when status is success",
    );

    assert.match(
      userPage,
      /!batchSendStatus\?\.startsWith\("Success"\) && \(\s*<BalanceRoutingNotice/,
      "Batch send must not render BalanceRoutingNotice when batchSendStatus indicates success",
    );

    assert.match(
      userPage,
      /loadUserSettings\(\)\.catch\(console\.error\)/,
      "DepositModal onSuccess must reload user settings to update deposit transactions immediately",
    );
  });
});
