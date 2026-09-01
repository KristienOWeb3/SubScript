import { ethers } from "ethers";
import { pgQuery } from "@/lib/serverPg";
import {
  CCTP_CONFIG,
  ARC_CCTP_DOMAIN_ID,
  BRIDGE_FEE_TREASURY_ADDRESS,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
} from "@/lib/contracts/constants";
import {
  TOKEN_MESSENGER_V2_ABI,
  ERC20_ABI,
  FINALITY_THRESHOLD_STANDARD,
  ANY_DESTINATION_CALLER,
  addressToBytes32,
} from "./circleBridge";
import { deriveDepositSigner } from "./depositAddresses";
import { getChainRelayer, resolveRpcUrl } from "./relayer";
import { calculateBridgeFee, formatMicros, getMinBridgeAmount } from "./feeEngine";
import { notifyDepositStarted, notifyAdminsLowGas } from "./notifications";
import { processPendingCctpTransfers } from "./attestationWorker";

const isProd = process.env.NEXT_PUBLIC_APP_ENV === "production" || process.env.NODE_ENV === "production";
const targetArcChainId = isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;

/**
 * Auto-bridge sweep engine.
 *
 * Called by the CCTP keeper every 5 minutes. Scans derived deposit addresses that have active
 * intents, and for any with a USDC balance above the minimum, executes the full bridge:
 *
 *   1. Drip native gas from main relayer to derived address (if needed)
 *   2. approve(TokenMessengerV2, amount) from derived address
 *   3. USDC.transfer(treasury, fee) from derived address
 *   4. depositForBurn(netAmount, arcDomain, userMintRecipient) from derived address
 *   5. Record in cctp_bridge_transfers → attestation worker handles the rest
 *
 * SECURITY: All signing happens server-side. No env vars are ever exposed to the client.
 */

/* How much native gas to drip for a bridge (approve + transfer + depositForBurn). */
const GAS_DRIP_WEI: Record<number, bigint> = {
  1: ethers.parseEther("0.015"),        // Ethereum Mainnet
  11155111: ethers.parseEther("0.015"), // Ethereum Sepolia
  43114: ethers.parseEther("0.05"),     // Avalanche C-Chain
  43113: ethers.parseEther("0.05"),     // Avalanche Fuji
  137: ethers.parseEther("0.5"),        // Polygon Mainnet
  80002: ethers.parseEther("0.5"),      // Polygon Amoy
  8453: ethers.parseEther("0.0008"),    // Base
  84532: ethers.parseEther("0.0008"),   // Base Sepolia
  42161: ethers.parseEther("0.0008"),   // Arbitrum One
  421614: ethers.parseEther("0.0008"),  // Arbitrum Sepolia
  10: ethers.parseEther("0.0008"),      // Optimism
  11155420: ethers.parseEther("0.0008"),// OP Sepolia
};

/* Don't drip if the derived address already has more than this much native gas. */
const GAS_DRIP_THRESHOLD_MAP: Record<number, bigint> = {
  1: ethers.parseEther("0.008"),
  11155111: ethers.parseEther("0.008"),
  43114: ethers.parseEther("0.02"),
  43113: ethers.parseEther("0.02"),
  137: ethers.parseEther("0.2"),
  80002: ethers.parseEther("0.2"),
};

const DEFAULT_GAS_DRIP_WEI = ethers.parseEther("0.001");
const DEFAULT_GAS_DRIP_THRESHOLD_WEI = ethers.parseEther("0.0003");

/* Maximum intents to process per keeper tick. Prevents a single tick from running too long. */
const MAX_INTENTS_PER_TICK = 20;

/* RPC read timeout per chain */
const BALANCE_TIMEOUT_MS = 5_000;

export interface SweepResult {
  scanned: number;
  bridged: number;
  skipped: number;
  errors: number;
}

interface ActiveIntent {
  id: string;
  user_wallet: string;
  derived_deposit_address: string;
  origin_chain_id: number;
}

/**
 * Main entry point. Scans all active deposit intents and bridges any detected USDC.
 */
export async function sweepAndBridge(): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, bridged: 0, skipped: 0, errors: 0 };

  let intents: ActiveIntent[];
  try {
    intents = await pgQuery<ActiveIntent>(
      `SELECT id, user_wallet, derived_deposit_address, origin_chain_id
         FROM cctp_deposit_intents
        WHERE status = 'active'
          AND expires_at > now()
        ORDER BY created_at ASC
        LIMIT $1`,
      [MAX_INTENTS_PER_TICK],
    );
  } catch (error: any) {
    console.error("[AutoBridge] could not read active intents:", error?.message);
    return result;
  }

  if (intents.length === 0) return result;

  /* Expire old intents */
  await pgQuery(
    `UPDATE cctp_deposit_intents SET status = 'expired', updated_at = now()
      WHERE status = 'active' AND expires_at <= now()`,
    [],
  ).catch(() => undefined);

  /* Deduplicate: if multiple intents point to the same (derived_address, chain), process once. */
  const seen = new Set<string>();
  const unique: ActiveIntent[] = [];
  const distinctAddresses = new Set<string>();

  for (const intent of intents) {
    const key = `${intent.derived_deposit_address}:${intent.origin_chain_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(intent);
    }
    if (!distinctAddresses.has(intent.derived_deposit_address)) {
      distinctAddresses.add(intent.derived_deposit_address);
      // Also queue an Arc check for this user's derived address if not already queued
      if (intent.origin_chain_id !== ARC_TESTNET_CHAIN_ID && intent.origin_chain_id !== ARC_MAINNET_CHAIN_ID) {
        unique.push({
          id: `arc-${intent.id}`,
          user_wallet: intent.user_wallet,
          derived_deposit_address: intent.derived_deposit_address,
          origin_chain_id: targetArcChainId,
        });
      }
    }
  }

  for (const intent of unique) {
    result.scanned++;
    try {
      const bridged = await processIntent(intent);
      if (bridged) {
        result.bridged++;
      } else {
        result.skipped++;
      }
    } catch (error: any) {
      result.errors++;
      console.error(
        `[AutoBridge] error processing intent ${intent.id} (chain ${intent.origin_chain_id}):`,
        error?.message,
      );
    }
  }

  /* If we bridged anything, kick the attestation worker so it starts polling Iris immediately. */
  if (result.bridged > 0) {
    void processPendingCctpTransfers().catch(() => undefined);
  }

  return result;
}

/**
 * Sweeps native USDC sent to the derived router address on Arc directly to the user's wallet.
 */
async function processArcIntent(intent: ActiveIntent): Promise<boolean> {
  const { user_wallet, derived_deposit_address, origin_chain_id } = intent;
  const arcChainId = origin_chain_id || targetArcChainId;
  const rpc = resolveRpcUrl(arcChainId);
  if (!rpc) return false;

  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });

  let nativeBal: bigint;
  try {
    nativeBal = await Promise.race([
      provider.getBalance(derived_deposit_address) as Promise<bigint>,
      new Promise<bigint>((_, reject) =>
        setTimeout(() => reject(new Error("RPC timeout")), BALANCE_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return false;
  }

  // Minimum 0.05 USDC to route on Arc (18 decimals: 0.05 * 1e18)
  const minSweepArc = ethers.parseUnits("0.05", 18);
  if (nativeBal < minSweepArc) {
    return false;
  }

  console.log(
    `[AutoBridge] detected ${ethers.formatUnits(nativeBal, 18)} USDC on Arc at ${derived_deposit_address}, auto-routing to ${user_wallet}`,
  );

  const originDepositor = user_wallet;
  const signer = deriveDepositSigner(user_wallet, arcChainId);
  const gasReserve = ethers.parseUnits("0.002", 18);

  const sendAmount = nativeBal > gasReserve ? nativeBal - gasReserve : 0n;
  if (sendAmount <= 0n) return false;

  const tx = await signer.sendTransaction({
    to: user_wallet,
    value: sendAmount,
  });
  const receipt = await tx.wait();
  const txHash = receipt?.hash || tx.hash;
  console.log(`[AutoBridge] Arc sweep completed: ${txHash} (${ethers.formatUnits(sendAmount, 18)} USDC net) to ${user_wallet}`);

  // On Arc, 18 decimals -> 6 decimals (micros).
  // Native Arc deposits are 0% fee, satisfying DB constraint: gross = fee + net
  const netMicros = sendAmount / (10n ** 12n);
  const grossMicros = netMicros;
  const feeMicros = 0n;

  if (grossMicros <= 0n) return false;

  await pgQuery(
    `INSERT INTO cctp_bridge_transfers
       (direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
        destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
        net_amount_micros, fee_bps, fee_tx_hash, mint_tx_hash, status)
     VALUES ('inbound_deposit', $1, $2, $3, $4, $3, $4, $5, 0, $5, 0, NULL, $6, 'completed')
     ON CONFLICT DO NOTHING`,
    [
      originDepositor,
      user_wallet,
      String(arcChainId),
      ARC_CCTP_DOMAIN_ID,
      grossMicros.toString(),
      txHash,
    ],
  ).catch((err) => {
    console.warn("[AutoBridge] could not record Arc sweep transfer:", err?.message);
  });

  await pgQuery(
    `UPDATE cctp_deposit_intents
        SET status = 'matched', updated_at = now()
      WHERE user_wallet = $1 AND origin_chain_id = $2 AND status = 'active'`,
    [user_wallet, origin_chain_id],
  ).catch(() => undefined);

  return true;
}

/**
 * Process a single deposit intent: check balance, drip gas, burn via CCTP.
 * Returns true if a bridge was executed, false if skipped (no balance or already bridging).
 */
async function processIntent(intent: ActiveIntent): Promise<boolean> {
  const { user_wallet, derived_deposit_address, origin_chain_id } = intent;

  const isArc = origin_chain_id === ARC_TESTNET_CHAIN_ID || origin_chain_id === ARC_MAINNET_CHAIN_ID;
  if (isArc) {
    return processArcIntent(intent);
  }

  const chainConfig = CCTP_CONFIG[origin_chain_id];
  if (!chainConfig) {
    console.warn(`[AutoBridge] no CCTP config for chain ${origin_chain_id}, skipping.`);
    return false;
  }

  /* Check if there's already a pending transfer for this address + chain. */
  const existing = await pgQuery<{ id: string; status: string; fee_tx_hash: string | null }>(
    `SELECT id, status, fee_tx_hash FROM cctp_bridge_transfers
      WHERE (user_wallet = $1 OR recipient_address = $1)
        AND origin_chain_id = $2
        AND status IN ('pending_burn', 'pending_fee', 'pending_attestation', 'minting')
      LIMIT 1`,
    [user_wallet, String(origin_chain_id)],
  );
  if (existing.length > 0 && existing[0].status !== "pending_burn" && existing[0].status !== "pending_fee") {
    return false; /* Already active and beyond fee step. */
  }

  /* Read USDC balance at the derived deposit address on the origin chain. */
  const rpc = resolveRpcUrl(origin_chain_id);
  if (!rpc) return false;

  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const usdc = new ethers.Contract(chainConfig.usdc, ERC20_ABI, provider);

  let balanceBigInt: bigint;
  try {
    balanceBigInt = await Promise.race([
      usdc.balanceOf(derived_deposit_address) as Promise<bigint>,
      new Promise<bigint>((_, reject) =>
        setTimeout(() => reject(new Error("RPC timeout")), BALANCE_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return false; /* RPC down or timeout — skip this chain, try next tick. */
  }

  const minRequired = getMinBridgeAmount(origin_chain_id);
  if (balanceBigInt < minRequired) {
    if (balanceBigInt > 0n) {
      console.log(
        `[AutoBridge] ${derived_deposit_address} on ${chainConfig.name} has ${formatMicros(balanceBigInt)} USDC (below minimum ${formatMicros(minRequired)} USDC) — funds stored safely on chain, waiting for balance to reach >= ${formatMicros(minRequired)} USDC.`,
      );
    }
    return false; /* Not enough to bridge yet. Keeps intent active for when user adds more funds. */
  }

  console.log(
    `[AutoBridge] detected ${formatMicros(balanceBigInt)} USDC at ${derived_deposit_address} on ${chainConfig.name} (>= min ${formatMicros(minRequired)} USDC)`,
  );

  /* Calculate fee split. */
  const feeInfo = calculateBridgeFee(balanceBigInt.toString(), origin_chain_id, "inbound_deposit");

  /* Drip native gas to the derived address if needed. */
  await dripGasIfNeeded(derived_deposit_address, origin_chain_id, provider);

  /* Get the signer for the derived deposit address. */
  const signer = deriveDepositSigner(user_wallet, origin_chain_id);

  /* The user's Arc address (where minted USDC lands) is their own wallet address. */
  const mintRecipient = addressToBytes32(user_wallet);

  /* Step 1: Approve TokenMessengerV2 to spend the full USDC balance. */
  const usdcWithSigner = new ethers.Contract(chainConfig.usdc, ERC20_ABI, signer);
  const approveTx = await usdcWithSigner.approve(chainConfig.tokenMessenger, balanceBigInt);
  await approveTx.wait();
  console.log(`[AutoBridge] approve tx: ${approveTx.hash}`);

  /* Insert or reuse existing transfer row to prevent double-fee deductions on retries */
  let transferId: string;
  let feeTxHash: string | null = existing[0]?.fee_tx_hash || null;

  if (existing.length > 0) {
    transferId = existing[0].id;
  } else {
    const inserted = await pgQuery<{ id: string }>(
      `INSERT INTO cctp_bridge_transfers
         (direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
          destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
          net_amount_micros, fee_bps, fee_tx_hash, status)
       VALUES ('inbound_deposit', $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 'pending_burn')
       RETURNING id`,
      [
        user_wallet,
        String(origin_chain_id),
        chainConfig.domain,
        String(targetArcChainId),
        ARC_CCTP_DOMAIN_ID,
        feeInfo.grossMicros.toString(),
        feeInfo.feeMicros.toString(),
        feeInfo.netMicros.toString(),
        feeInfo.feeBps,
      ],
    );
    transferId = inserted[0]?.id || "";
  }

  /* Step 2: Transfer fee to treasury (if fee > 0 and not already sent). */
  if (feeInfo.feeMicros > 0n && !feeTxHash) {
    const feeTx = await usdcWithSigner.transfer(BRIDGE_FEE_TREASURY_ADDRESS, feeInfo.feeMicros);
    await feeTx.wait();
    feeTxHash = feeTx.hash;
    console.log(`[AutoBridge] fee tx: ${feeTxHash} (${formatMicros(feeInfo.feeMicros)} USDC)`);

    if (transferId) {
      await pgQuery(
        `UPDATE cctp_bridge_transfers
            SET fee_tx_hash = $2, status = 'pending_fee', updated_at = now()
          WHERE id = $1`,
        [transferId, feeTxHash],
      ).catch(() => undefined);
    }
  }

  /* Step 3: depositForBurn — the net amount goes through CCTP to Arc. */
  const tokenMessenger = new ethers.Contract(
    chainConfig.tokenMessenger,
    TOKEN_MESSENGER_V2_ABI,
    signer,
  );
  const burnTx = await tokenMessenger.depositForBurn(
    feeInfo.netMicros,           /* amount */
    ARC_CCTP_DOMAIN_ID,          /* destinationDomain */
    mintRecipient,               /* mintRecipient (user's address on Arc, bytes32) */
    chainConfig.usdc,            /* burnToken */
    ANY_DESTINATION_CALLER,      /* destinationCaller (anyone can relay) */
    0,                           /* maxFee (standard finality = no fee) */
    FINALITY_THRESHOLD_STANDARD, /* minFinalityThreshold (2000 = finalized) */
  );
  const burnReceipt = await burnTx.wait();
  if (burnReceipt && burnReceipt.status !== 1) {
    throw new Error("depositForBurn reverted on chain.");
  }
  const burnTxHash = burnReceipt?.hash || burnTx.hash;
  console.log(`[AutoBridge] burn tx: ${burnTxHash} (${formatMicros(feeInfo.netMicros)} USDC net)`);

  /* Find who deposited funds to the derived router address on the origin chain (e.g. 0x123). */
  let originDepositor = user_wallet;
  try {
    const filter = usdc.filters.Transfer(null, derived_deposit_address);
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 5000);
    const events = await usdc.queryFilter(filter, fromBlock, latestBlock);
    if (events.length > 0) {
      const lastEvent: any = events[events.length - 1];
      if (lastEvent.args && lastEvent.args[0]) {
        originDepositor = String(lastEvent.args[0]).toLowerCase();
      }
    }
  } catch {
    // Best-effort lookup, fallback to user_wallet
  }

  /* Step 4: Advance the transfer to pending_attestation with the burnTxHash. */
  if (transferId) {
    await pgQuery(
      `UPDATE cctp_bridge_transfers
          SET burn_tx_hash = $2,
              user_wallet = $3,
              fee_tx_hash = COALESCE($4, fee_tx_hash),
              status = 'pending_attestation',
              updated_at = now()
        WHERE id = $1`,
      [transferId, burnTxHash, originDepositor, feeTxHash],
    );
  } else {
    const inserted = await pgQuery<{ id: string }>(
      `INSERT INTO cctp_bridge_transfers
         (direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
          destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
          net_amount_micros, fee_bps, fee_tx_hash, burn_tx_hash, status)
       VALUES ('inbound_deposit', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending_attestation')
       ON CONFLICT (burn_tx_hash) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        originDepositor,
        user_wallet,
        String(origin_chain_id),
        chainConfig.domain,
        String(targetArcChainId),
        ARC_CCTP_DOMAIN_ID,
        feeInfo.grossMicros.toString(),
        feeInfo.feeMicros.toString(),
        feeInfo.netMicros.toString(),
        feeInfo.feeBps,
        feeTxHash,
        burnTxHash,
      ],
    );
    transferId = inserted[0]?.id || "";
  }

  /* Step 5: Mark the intent as matched. */
  await pgQuery(
    `UPDATE cctp_deposit_intents
        SET status = 'matched', matched_transfer_id = $2, updated_at = now()
      WHERE user_wallet = $1 AND origin_chain_id = $3 AND status = 'active'`,
    [user_wallet, transferId || null, origin_chain_id],
  ).catch(() => undefined);

  /* Step 6: Send notification. */
  await notifyDepositStarted({
    recipientAddress: user_wallet,
    originChainName: chainConfig.name,
  });

  console.log(
    `[AutoBridge] bridge initiated: ${formatMicros(feeInfo.grossMicros)} USDC from ${chainConfig.name} → Arc (transfer ${transferId})`,
  );

  return true;
}

/**
 * Sends a small amount of native gas from the main relayer to a derived deposit address,
 * but only if it doesn't already have enough to cover the bridge transactions.
 */
async function dripGasIfNeeded(
  derivedAddress: string,
  chainId: number,
  provider: ethers.JsonRpcProvider,
): Promise<void> {
  const threshold = GAS_DRIP_THRESHOLD_MAP[chainId] || DEFAULT_GAS_DRIP_THRESHOLD_WEI;
  const currentBalance = await provider.getBalance(derivedAddress);
  if (currentBalance >= threshold) {
    return; /* Already has enough gas. */
  }

  const relayer = getChainRelayer(chainId);
  const relayerBalance = await provider.getBalance(relayer.address).catch(() => 0n);
  const chainConfig = CCTP_CONFIG[chainId];
  const nativeSymbol = chainConfig?.nativeTokenSymbol || "ETH";
  const chainName = chainConfig?.name || `Chain ${chainId}`;

  // If relayer balance is below 0.005 native tokens, alert all admins
  const LOW_GAS_RELAYER_THRESHOLD = ethers.parseEther("0.005");
  if (relayerBalance < LOW_GAS_RELAYER_THRESHOLD) {
    void notifyAdminsLowGas({
      chainName,
      chainId,
      walletAddress: relayer.address,
      walletRole: "Relayer / Sponsor Wallet",
      balanceFormatted: ethers.formatEther(relayerBalance),
      tokenSymbol: nativeSymbol,
      thresholdFormatted: "0.005",
    }).catch(() => undefined);
  }

  const dripAmount = GAS_DRIP_WEI[chainId] || DEFAULT_GAS_DRIP_WEI;

  console.log(
    `[AutoBridge] dripping ${ethers.formatEther(dripAmount)} native gas to ${derivedAddress} on chain ${chainId}`,
  );

  const tx = await relayer.sendTransaction({
    to: derivedAddress,
    value: dripAmount,
  });
  await tx.wait();
  console.log(`[AutoBridge] gas drip tx: ${tx.hash}`);
}
