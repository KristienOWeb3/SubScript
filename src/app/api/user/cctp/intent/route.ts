import { NextRequest, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { pgQuery, pgMaybeOne } from "@/lib/serverPg";
import {
  CCTP_CONFIG,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
} from "@/lib/contracts/constants";
import { deriveDepositAddress } from "@/lib/cctp/depositAddresses";
import { formatFeeBps } from "@/lib/cctp/feeEngine";

export const maxDuration = 15;

/**
 * POST — Register a deposit intent.
 *
 * Called when the user selects a CCTP chain in the deposit modal. Records which chain they plan
 * to deposit on so the keeper knows which derived addresses to scan. Returns the derived deposit
 * address for the selected chain.
 *
 * Body: { originChainId: number }
 * Returns: { depositAddress, chainName, fee, feeBps, intentId }
 */
export async function POST(req: NextRequest) {
  try {
    const wallet = await getSessionWallet(req.headers);
    if (!wallet) {
      return NextResponse.json(
        { error: "Please connect your wallet and try again." },
        { status: 401 },
      );
    }
    const userWallet = wallet.toLowerCase();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const chainId = Number(body.originChainId);
    const isArc = chainId === ARC_TESTNET_CHAIN_ID || chainId === ARC_MAINNET_CHAIN_ID;
    const chainConfig = CCTP_CONFIG[chainId];
    if (!chainConfig && !isArc) {
      return NextResponse.json(
        { error: "That network isn't supported for deposits." },
        { status: 400 },
      );
    }

    const derivedAddress = deriveDepositAddress(userWallet);

    /* Upsert: if an active intent for this wallet + chain already exists, refresh its expiry
       instead of creating a duplicate. */
    const existing = await pgMaybeOne<{ id: string }>(
      `SELECT id FROM cctp_deposit_intents
        WHERE user_wallet = $1 AND origin_chain_id = $2 AND status = 'active'
        LIMIT 1`,
      [userWallet, chainId],
    );

    let intentId: string;
    if (existing) {
      await pgQuery(
        `UPDATE cctp_deposit_intents
            SET expires_at = now() + INTERVAL '24 hours', updated_at = now()
          WHERE id = $1`,
        [existing.id],
      );
      intentId = existing.id;
    } else {
      const inserted = await pgQuery<{ id: string }>(
        `INSERT INTO cctp_deposit_intents
           (user_wallet, derived_deposit_address, origin_chain_id, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [userWallet, derivedAddress, chainId],
      );
      intentId = inserted[0]?.id || "";
    }

    const feeBps = chainConfig ? chainConfig.feeBps : 100;
    return NextResponse.json({
      depositAddress: derivedAddress,
      chainName: chainConfig?.name || "Arc Network",
      chainId,
      feeBps,
      fee: formatFeeBps(feeBps),
      intentId,
    });
  } catch (error: any) {
    console.error("[api/user/cctp/intent] POST error:", error?.message);
    return NextResponse.json(
      { error: "Something went wrong registering your deposit intent." },
      { status: 500 },
    );
  }
}

/**
 * GET — Query active intents and their status.
 *
 * Returns the user's active deposit intents with their derived deposit addresses, chain info,
 * and whether a bridge transfer has been matched.
 */
export async function GET(req: NextRequest) {
  try {
    const wallet = await getSessionWallet(req.headers);
    if (!wallet) {
      return NextResponse.json(
        { error: "Please connect your wallet and try again." },
        { status: 401 },
      );
    }
    const userWallet = wallet.toLowerCase();

    const intents = await pgQuery<{
      id: string;
      derived_deposit_address: string;
      origin_chain_id: number;
      status: string;
      matched_transfer_id: string | null;
      created_at: string;
      expires_at: string;
    }>(
      `SELECT id, derived_deposit_address, origin_chain_id, status,
              matched_transfer_id, created_at, expires_at
         FROM cctp_deposit_intents
        WHERE user_wallet = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [userWallet],
    );

    /* If there are matched intents, fetch the transfer status. */
    const transferIds = intents
      .map((i) => i.matched_transfer_id)
      .filter((id): id is string => Boolean(id));

    let transfers: Record<string, { status: string; mint_tx_hash: string | null }> = {};
    if (transferIds.length > 0) {
      const rows = await pgQuery<{ id: string; status: string; mint_tx_hash: string | null }>(
        `SELECT id, status, mint_tx_hash FROM cctp_bridge_transfers WHERE id = ANY($1)`,
        [transferIds],
      );
      for (const row of rows) {
        transfers[row.id] = { status: row.status, mint_tx_hash: row.mint_tx_hash };
      }
    }

    const enriched = intents.map((intent) => {
      const chainConfig = CCTP_CONFIG[intent.origin_chain_id];
      const transfer = intent.matched_transfer_id
        ? transfers[intent.matched_transfer_id]
        : undefined;

      return {
        id: intent.id,
        depositAddress: intent.derived_deposit_address,
        chainId: intent.origin_chain_id,
        chainName: chainConfig?.name || `Chain ${intent.origin_chain_id}`,
        feeBps: chainConfig?.feeBps ?? 0,
        intentStatus: intent.status,
        bridgeStatus: transfer?.status || null,
        mintTxHash: transfer?.mint_tx_hash || null,
        createdAt: intent.created_at,
        expiresAt: intent.expires_at,
      };
    });

    return NextResponse.json({ intents: enriched });
  } catch (error: any) {
    console.error("[api/user/cctp/intent] GET error:", error?.message);
    return NextResponse.json(
      { error: "Something went wrong fetching your deposit intents." },
      { status: 500 },
    );
  }
}
