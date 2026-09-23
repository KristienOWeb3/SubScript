import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateRouteGas,
  checkCctpRouteAvailability,
  getAllRoutesAvailability,
  __resetRouteAvailabilityCache,
} from "../routeAvailability.ts";
import { statusFor, RELAYER_GAS_THRESHOLDS } from "../relayerGas.ts";

const repoRoot = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, repoRoot), "utf8");


/* No RPC mock harness exists in this repo, so the gas decision is a pure function tested directly,
   and the cache/failure paths are exercised by injecting a fake balance reader and clock. */
const reads = (balance) => async () => ({ balance, raw: String(balance ?? 0) });
const failsToRead = async () => ({ balance: null, raw: "0", error: "RPC unreachable" });

describe("evaluateRouteGas (pure decision)", () => {
  it("is Live when balance is above the critical threshold", () => {
    const v = evaluateRouteGas("1", 0.5); // Ethereum critical 0.02
    assert.equal(v.available, true);
    assert.equal(v.status, "live");
    assert.equal(v.badge, "Live");
    assert.equal(v.unavailableReason, null);
  });

  it("is Unavailable ⛽ / gas_depleted at or below critical", () => {
    const v = evaluateRouteGas("1", 0.01); // below 0.02 critical
    assert.equal(v.available, false);
    assert.equal(v.status, "gas_depleted");
    assert.equal(v.badge, "Unavailable ⛽");
    assert.match(v.unavailableReason, /gas reserve low/i);
    // Exactly at critical is still depleted (statusFor uses a strict > comparison).
    assert.equal(evaluateRouteGas("1", 0.02).status, "gas_depleted");
  });

  it("falls back to the default threshold for chains without their own line", () => {
    assert.equal(RELAYER_GAS_THRESHOLDS["42161"], undefined); // Arbitrum -> default {0.05, 0.01}
    assert.equal(evaluateRouteGas("42161", 0.02).status, "live"); // > 0.01
    assert.equal(evaluateRouteGas("42161", 0.005).status, "gas_depleted");
  });

  it("fails closed when the balance is unknown", () => {
    const v = evaluateRouteGas("1", null);
    assert.equal(v.available, false);
    assert.equal(v.status, "unavailable");
    assert.equal(v.badge, "Unavailable ⛽");
  });

  it("agrees with statusFor about the critical boundary", () => {
    assert.equal(statusFor("solana", 0.04), "critical"); // solana critical 0.05
    assert.equal(evaluateRouteGas("solana", 0.04).available, false);
    assert.equal(statusFor("solana", 1), "healthy");
    assert.equal(evaluateRouteGas("solana", 1).available, true);
  });
});

describe("checkCctpRouteAvailability", () => {
  beforeEach(() => __resetRouteAvailabilityCache());

  it("returns Live for the Arc route without probing gas", async () => {
    let calls = 0;
    const v = await checkCctpRouteAvailability("outbound_withdrawal", "arc", {
      readBalance: async () => {
        calls++;
        return { balance: 0, raw: "0" };
      },
    });
    assert.equal(v.available, true);
    assert.equal(v.status, "live");
    assert.equal(calls, 0);
  });

  it("reads the destination relayer and reports Live when funded", async () => {
    let calls = 0;
    const v = await checkCctpRouteAvailability("outbound_withdrawal", "1", {
      readBalance: async () => {
        calls++;
        return { balance: 0.5, raw: "0" };
      },
      now: () => 1000,
    });
    assert.equal(v.available, true);
    assert.equal(v.status, "live");
    assert.equal(calls, 1);
  });

  it("reports gas_depleted when the destination relayer is under critical", async () => {
    const v = await checkCctpRouteAvailability("outbound_withdrawal", "1", {
      readBalance: reads(0.001),
      now: () => 1000,
    });
    assert.equal(v.available, false);
    assert.equal(v.status, "gas_depleted");
    assert.equal(v.badge, "Unavailable ⛽");
  });

  it("caches within the TTL and refreshes once it expires", async () => {
    let calls = 0;
    let clock = 1000;
    const opts = {
      readBalance: async () => {
        calls++;
        return { balance: 0.5, raw: "0" };
      },
      now: () => clock,
    };
    await checkCctpRouteAvailability("outbound_withdrawal", "1", opts); // read #1
    await checkCctpRouteAvailability("outbound_withdrawal", "1", opts); // cache hit
    assert.equal(calls, 1);
    clock += 46_000; // past the 45s TTL
    await checkCctpRouteAvailability("outbound_withdrawal", "1", opts); // read #2
    assert.equal(calls, 2);
  });

  it("fails closed when a cached healthy verdict expires and the refresh fails", async () => {
    let clock = 1000;
    await checkCctpRouteAvailability("outbound_withdrawal", "1", { readBalance: reads(0.5), now: () => clock });
    clock += 46_000; // cache now stale, force a fresh (failing) read
    const v = await checkCctpRouteAvailability("outbound_withdrawal", "1", { readBalance: failsToRead, now: () => clock });
    assert.equal(v.available, false);
    assert.equal(v.status, "unavailable");
  });

  it("fails closed when a read fails and nothing is cached", async () => {
    const v = await checkCctpRouteAvailability("outbound_withdrawal", "1", { readBalance: failsToRead, now: () => 1000 });
    assert.equal(v.available, false);
    assert.equal(v.status, "unavailable");
    assert.equal(v.badge, "Unavailable ⛽");
  });

  it("checks the Arc relayer for inbound deposits regardless of source route", async () => {
    let seen = null;
    const v = await checkCctpRouteAvailability("inbound_deposit", "1", {
      readBalance: async (target) => {
        seen = target;
        return { balance: 1, raw: "0" }; // arc critical is 2 USDC -> depleted
      },
      now: () => 1000,
    });
    assert.equal(v.status, "gas_depleted");
    assert.equal(seen.thresholdKey, "arc");
    assert.equal(seen.cacheKey, "inbound_deposit:arc");
  });
});

describe("getAllRoutesAvailability", () => {
  beforeEach(() => __resetRouteAvailabilityCache());

  it("always reports Arc as live with its fee badge", async () => {
    const routes = await getAllRoutesAvailability("outbound_withdrawal", { readBalance: reads(0.5) });
    const arc = routes.find((r) => r.id === "arc");
    assert.ok(arc, "arc route present");
    assert.equal(arc.available, true);
    assert.equal(arc.status, "live");
    assert.equal(arc.badge, "0% Fee · Instant");
  });
});

/* Route behaviour is verified the way the rest of the suite does it (there is no live-RPC harness):
   by asserting the guard is wired into the source in the right order. */
describe("withdraw fail-closed guard wiring", () => {
  it("checks route gas before the burn and the DB row in the server-held withdraw route", () => {
    const route = source("src/app/api/user/cctp/withdraw/route.ts");
    const guardAt = route.indexOf('checkCctpRouteAvailability("outbound_withdrawal"');
    const insertAt = route.indexOf("INSERT INTO cctp_bridge_transfers");
    const burnAt = route.indexOf('functionName: "depositForBurn"');
    assert.ok(guardAt > 0, "route must call checkCctpRouteAvailability");
    assert.ok(insertAt > guardAt, "guard must run before the DB row is written");
    assert.ok(burnAt > guardAt, "guard must run before the burn");
    const block = route.slice(guardAt, guardAt + 400);
    assert.match(block, /status: 503/);
    assert.match(block, /have not been burned/);
  });

  it("does NOT guard the register (post-burn) route, which would strand already-burned funds", () => {
    const register = source("src/app/api/user/cctp/withdraw/register/route.ts");
    assert.doesNotMatch(register, /checkCctpRouteAvailability/);
  });
});
