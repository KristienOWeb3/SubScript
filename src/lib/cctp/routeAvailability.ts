import { ARC_CCTP_ENABLED, SOLANA_CCTP_CONFIG } from "@/lib/contracts/constants";
import { getArcRpcUrl, getRelayerAddress, resolveRpcUrl } from "@/lib/cctp/relayer";
import { getSolanaRelayerAddress } from "@/lib/cctp/solanaRelayer";
import { listBridgeRoutes } from "@/lib/cctp/feeEngine";
import type { BridgeDirection, BridgeRouteOption } from "@/lib/cctp/types";
import {
  readEvmNativeBalance,
  readSolanaNativeBalance,
  statusFor,
  type NativeBalanceRead,
} from "@/lib/cctp/relayerGas";

/**
 * Live, gas-aware CCTP route availability.
 *
 * A cross-chain transfer only completes if the relayer that mints on the far side has native gas to
 * pay for it. An outbound withdrawal mints on the destination chain; an inbound deposit mints on Arc.
 * This module turns a relayer's live gas balance into a "Live" / "Unavailable ⛽" verdict per route,
 * cached briefly so the picker and the withdrawal guard don't hammer RPC on every request.
 *
 * The verdict deliberately fails closed: if a relayer's gas cannot be confirmed and there is no recent
 * healthy reading to fall back on, the route reads unavailable rather than letting a burn strand a
 * user's USDC on a chain that can't mint it.
 */

export type RouteAvailabilityStatus = "live" | "gas_depleted" | "unavailable" | "coming_soon";

export interface RouteAvailability {
  available: boolean;
  status: RouteAvailabilityStatus;
  badge: "Live" | "Unavailable ⛽";
  unavailableReason: string | null;
}

/* One row per network the status endpoint reports, ready for the UI to render a badge from. */
export interface RouteStatusEntry {
  id: string;
  name: string;
  available: boolean;
  status: RouteAvailabilityStatus;
  badge: string;
  unavailableReason: string | null;
}

const GAS_DEPLETED_REASON = "Sponsor gas reserve low — refilling in progress";

/* Long enough to spare RPC on a burst of picker polls, short enough that a wallet top-up flips a route
   back to Live within a poll cycle. Sits inside the 30–60s the picker polls on. */
const TTL_MS = 45_000;

const LIVE: RouteAvailability = { available: true, status: "live", badge: "Live", unavailableReason: null };
const COMING_SOON: RouteAvailability = {
  available: false,
  status: "coming_soon",
  badge: "Unavailable ⛽",
  unavailableReason: "Coming soon",
};

/**
 * Which relayer's gas decides this route, and where to read it. `none` is a route (Arc) that never
 * needs a CCTP mint and is therefore always live.
 */
export type RelayerTarget =
  | { kind: "none" }
  | { kind: "evm"; thresholdKey: string; rpc: string | null; address: string | null; cacheKey: string }
  | { kind: "solana"; thresholdKey: string; address: string | null; cacheKey: string };

export interface CheckOptions {
  /* Injected in tests so the cache and verdict logic can be exercised without a live RPC. */
  readBalance?: (target: RelayerTarget) => Promise<NativeBalanceRead>;
  now?: () => number;
  force?: boolean;
}

type CachedVerdict = { checkedAt: number; verdict: RouteAvailability };

/* Attached to globalThis so the cache survives Next's module reloads in dev, the same way the gas
   sponsor reuse-window cache does (see lib/sponsor/gas.ts). */
const cacheState = globalThis as typeof globalThis & {
  subscriptCctpRouteAvailability?: Map<string, CachedVerdict>;
};

function getRouteCache(): Map<string, CachedVerdict> {
  if (!cacheState.subscriptCctpRouteAvailability) {
    cacheState.subscriptCctpRouteAvailability = new Map();
  }
  return cacheState.subscriptCctpRouteAvailability;
}

/** Test-only: drop the cache so a fresh reading is taken next call. */
export function __resetRouteAvailabilityCache(): void {
  getRouteCache().clear();
}

/**
 * Pure gas-to-verdict decision. Kept separate from any I/O so it can be unit-tested directly with a
 * mock balance — the repo has no RPC mock harness, so the logic has to be testable without one.
 */
export function evaluateRouteGas(chainKey: string, balance: number | null): RouteAvailability {
  if (balance === null) {
    return {
      available: false,
      status: "unavailable",
      badge: "Unavailable ⛽",
      unavailableReason: "Couldn't confirm relayer gas just now",
    };
  }
  if (statusFor(chainKey, balance) === "critical") {
    return { available: false, status: "gas_depleted", badge: "Unavailable ⛽", unavailableReason: GAS_DEPLETED_REASON };
  }
  return { available: true, status: "live", badge: "Live", unavailableReason: null };
}

function resolveRelayerTarget(direction: BridgeDirection, id: string): RelayerTarget {
  /* Inbound deposits mint on Arc, so availability turns on the Arc relayer's gas (denominated in USDC)
     regardless of the source chain — every inbound route shares one verdict. */
  if (direction === "inbound_deposit") {
    return {
      kind: "evm",
      thresholdKey: "arc",
      rpc: getArcRpcUrl(),
      address: getRelayerAddress(),
      cacheKey: "inbound_deposit:arc",
    };
  }
  /* Outbound withdrawals mint on the destination chain. */
  if (id === "solana" || Number(id) === SOLANA_CCTP_CONFIG.domain) {
    return {
      kind: "solana",
      thresholdKey: "solana",
      address: getSolanaRelayerAddress(),
      cacheKey: "outbound_withdrawal:solana",
    };
  }
  const chainId = Number(id);
  return {
    kind: "evm",
    thresholdKey: id,
    rpc: Number.isFinite(chainId) ? resolveRpcUrl(chainId) : null,
    address: getRelayerAddress(),
    cacheKey: `outbound_withdrawal:${id}`,
  };
}

async function defaultReadBalance(target: RelayerTarget): Promise<NativeBalanceRead> {
  if (target.kind === "solana") {
    if (!target.address) return { balance: null, raw: "0", error: "No Solana relayer key configured" };
    return readSolanaNativeBalance(target.address);
  }
  if (target.kind === "evm") {
    if (!target.address) return { balance: null, raw: "0", error: "No relayer key configured" };
    return readEvmNativeBalance(target.rpc, target.address);
  }
  return { balance: null, raw: "0", error: "No gas check needed" };
}

/**
 * Live availability for one route. `routeId` is the route id the rest of the CCTP code uses:
 * "arc", "solana", or a chain id as a string (e.g. feeInfo.chainId).
 */
export async function checkCctpRouteAvailability(
  direction: BridgeDirection,
  routeId: string | number,
  opts: CheckOptions = {},
): Promise<RouteAvailability> {
  const now = opts.now ?? Date.now;
  const readBalance = opts.readBalance ?? defaultReadBalance;
  const id = String(routeId);

  /* Arc never uses a CCTP mint, so it is always live. */
  if (id === "arc") return LIVE;

  /* Compose with the build-time gate: no cross-chain route is live on Arc mainnet yet, so there is
     nothing to probe. */
  if (!ARC_CCTP_ENABLED) return COMING_SOON;

  const target = resolveRelayerTarget(direction, id);
  if (target.kind === "none") return LIVE;

  const cache = getRouteCache();
  const cached = cache.get(target.cacheKey);
  if (!opts.force && cached && now() - cached.checkedAt < TTL_MS) {
    return cached.verdict;
  }

  let read: NativeBalanceRead;
  try {
    read = await readBalance(target);
  } catch (error: any) {
    read = { balance: null, raw: "0", error: error?.message || "Balance check failed" };
  }

  if (read.balance === null) {
    /* A stale healthy balance is not proof that an irreversible burn is safe. Once the short cache
       TTL has elapsed, an RPC failure must fail closed; otherwise one old funded reading can keep a
       depleted destination marked Live indefinitely. */
    return {
      available: false,
      status: "unavailable",
      badge: "Unavailable ⛽",
      unavailableReason: read.error ? `Couldn't confirm relayer gas (${read.error})` : "Couldn't confirm relayer gas just now",
    };
  }

  const verdict = evaluateRouteGas(target.thresholdKey, read.balance);
  cache.set(target.cacheKey, { checkedAt: now(), verdict });
  return verdict;
}

function feeBadge(route: BridgeRouteOption): string {
  if (route.feeBps === 0) return "0% Fee · Instant";
  return `${route.feePercentage} Fee · ~15 min`;
}

/**
 * Availability for every route the picker can show, in one pass. Routes switched off at build time
 * (mainnet, or a disabled deposit/withdrawal toggle) are reported "Coming soon" without a gas probe.
 */
export async function getAllRoutesAvailability(
  direction: BridgeDirection,
  opts: CheckOptions = {},
): Promise<RouteStatusEntry[]> {
  const routes = listBridgeRoutes(direction);
  return Promise.all(
    routes.map(async (route): Promise<RouteStatusEntry> => {
      if (!route.available && route.id !== "arc") {
        return {
          id: route.id,
          name: route.name,
          available: false,
          status: "coming_soon",
          badge: "Unavailable ⛽",
          unavailableReason: route.unavailableReason ?? "Coming soon",
        };
      }
      const availability = await checkCctpRouteAvailability(direction, route.id, opts);
      return {
        id: route.id,
        name: route.name,
        available: availability.available,
        status: availability.status,
        badge: availability.available ? feeBadge(route) : "Unavailable ⛽",
        unavailableReason: availability.unavailableReason,
      };
    }),
  );
}
