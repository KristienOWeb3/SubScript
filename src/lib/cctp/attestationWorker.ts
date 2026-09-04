import { ethers } from "ethers";
import { pgQuery } from "@/lib/serverPg";
import {
  ARC_MESSAGE_TRANSMITTER_ADDRESS,
  ARC_CCTP_DOMAIN_ID,
  CCTP_CONFIG,
} from "@/lib/contracts/constants";
import {
  fetchCctpAttestation,
  isAlreadyMintedError,
  MESSAGE_TRANSMITTER_V2_ABI,
} from "./circleBridge";
import { getArcRelayer, getChainRelayer } from "./relayer";
import { notifyDepositArrived, notifyTransferStalled, notifyWithdrawalArrived } from "./notifications";
import { formatMicros } from "./feeEngine";
import { relayCctpMintToSolana } from "./solanaRelayer";

/* A burn is irreversible, so the worker keeps trying for a long time before it gives up. At the
   five-minute keeper cadence this is roughly two days of retries, which comfortably covers Ethereum
   finality, an Iris backlog, and a relayer that ran out of gas over a weekend. */
const MAX_ATTEMPTS = 576;

/* Iris rate-limits at 40 req/s and blocks for five minutes if you cross it. A small batch per tick
   keeps a backlog from tripping that. */
const BATCH_SIZE = 10;

interface PendingTransferRow {
  id: string;
  direction: "inbound_deposit" | "outbound_withdrawal";
  user_wallet: string;
  recipient_address: string;
  origin_chain_id: string;
  origin_domain: number;
  destination_chain_id: string;
  destination_domain: number;
  gross_amount_micros: string;
  fee_amount_micros: string;
  net_amount_micros: string;
  burn_tx_hash: string;
  attempt_count: number;
}

export interface CctpWorkerResult {
  processed: number;
  completed: number;
  waiting: number;
  failed: number;
}

/**
 * Resolves the MessageTransmitterV2 and signer for whichever chain a transfer needs to mint on.
 * Inbound deposits mint on Arc; outbound withdrawals mint on the destination chain.
 */
function resolveMintTarget(item: PendingTransferRow): {
  transmitter: string;
  relayer: ethers.Wallet;
  chainName: string;
} {
  if (item.direction === "inbound_deposit") {
    return {
      transmitter: ARC_MESSAGE_TRANSMITTER_ADDRESS,
      relayer: getArcRelayer(),
      chainName: "Arc",
    };
  }

  const destChainId = Number(item.destination_chain_id);
  const chainConfig = CCTP_CONFIG[destChainId];
  if (!chainConfig) {
    throw new Error(`No CCTP config for destination chain ${item.destination_chain_id}.`);
  }
  return {
    transmitter: chainConfig.messageTransmitter,
    relayer: getChainRelayer(destChainId),
    chainName: chainConfig.name,
  };
}

/** The domain the burn happened on, which is what Iris is keyed by. */
function sourceDomainFor(item: PendingTransferRow): number {
  return item.direction === "inbound_deposit" ? Number(item.origin_domain) : ARC_CCTP_DOMAIN_ID;
}

async function markWaiting(id: string, reason: string | null): Promise<void> {
  await pgQuery(
    `UPDATE cctp_bridge_transfers
        SET attempt_count = attempt_count + 1,
            error_message = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, reason],
  );
}

async function markFailed(item: PendingTransferRow, reason: string): Promise<void> {
  await pgQuery(
    `UPDATE cctp_bridge_transfers
        SET status = 'failed',
            attempt_count = attempt_count + 1,
            error_message = $2,
            updated_at = now()
      WHERE id = $1`,
    [item.id, reason],
  );
  await notifyTransferStalled({
    recipientAddress: item.direction === "inbound_deposit" ? item.recipient_address : item.user_wallet,
    reason: "It's been stuck longer than expected.",
  });
  console.error(`[CCTP Worker] ${item.id} moved to failed after ${item.attempt_count + 1} attempts: ${reason}`);
}

/**
 * Polls Circle for signed attestations and relays the resulting mints.
 *
 * Safe to run concurrently with itself: the claim below moves a row to `minting` in a single
 * conditional UPDATE, so two overlapping keeper ticks cannot relay the same burn twice.
 */
export async function processPendingCctpTransfers(): Promise<CctpWorkerResult> {
  const result: CctpWorkerResult = { processed: 0, completed: 0, waiting: 0, failed: 0 };

  let pending: PendingTransferRow[];
  try {
    pending = await pgQuery<PendingTransferRow>(
      `SELECT id, direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
              destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
              net_amount_micros, burn_tx_hash, attempt_count
         FROM cctp_bridge_transfers
        WHERE (status = 'pending_attestation' OR (status = 'minting' AND updated_at < now() - interval '5 minutes'))
          AND burn_tx_hash IS NOT NULL
        ORDER BY created_at ASC
        LIMIT $1`,
      [BATCH_SIZE],
    );
  } catch (error: any) {
    console.error("[CCTP Worker] could not read pending transfers:", error?.message);
    return result;
  }

  for (const item of pending) {
    result.processed++;

    if (item.attempt_count >= MAX_ATTEMPTS) {
      await markFailed(item, "Exceeded the retry budget waiting for Circle or the destination chain.");
      result.failed++;
      continue;
    }

    try {
      const attestation = await fetchCctpAttestation({
        sourceDomain: sourceDomainFor(item),
        burnTxHash: item.burn_tx_hash,
        expectedMintRecipient: item.recipient_address,
      });

      if (!attestation) {
        await markWaiting(item.id, null);
        result.waiting++;
        continue;
      }

      /* Claim the row before spending gas. The WHERE clause is the lock: only one worker can move a
         row out of pending_attestation, so a slow relay cannot be double-submitted by the next tick.
         Rows already in `minting` are retries of a claim whose relay did not confirm after 5 minutes. */
      const claimed = await pgQuery<{ id: string }>(
        `UPDATE cctp_bridge_transfers
            SET status = 'minting',
                attestation_bytes = $2,
                message_bytes = $3,
                message_hash = $4,
                attempt_count = attempt_count + 1,
                updated_at = now()
          WHERE id = $1
            AND (status = 'pending_attestation' OR (status = 'minting' AND updated_at < now() - interval '5 minutes'))
          RETURNING id`,
        [item.id, attestation.attestation, attestation.message, ethers.keccak256(attestation.message)],
      );
      if (claimed.length === 0) {
        /* Another worker took it, or it finished between the SELECT and here. */
        continue;
      }

      let mintTxHash: string;
      let chainName: string;

      const isSolana =
        Number(item.destination_domain) === 5 ||
        item.destination_chain_id === "solana" ||
        item.destination_chain_id === "5";

      if (isSolana) {
        chainName = "Solana";
        try {
          const res = await relayCctpMintToSolana({
            recipientAddress: item.recipient_address,
            messageBytes: attestation.message,
            attestationBytes: attestation.attestation,
          });
          mintTxHash = res.signature === "already_minted" ? item.burn_tx_hash : res.signature;
        } catch (relayError: any) {
          const message = String(relayError?.shortMessage || relayError?.message || relayError);
          if (!isAlreadyMintedError(message)) throw relayError;
          console.warn(`[CCTP Worker] ${item.id} was already minted on Solana; recording as complete.`);
          mintTxHash = item.burn_tx_hash;
        }
      } else {
        const target = resolveMintTarget(item);
        chainName = target.chainName;
        const messageTransmitter = new ethers.Contract(target.transmitter, MESSAGE_TRANSMITTER_V2_ABI, target.relayer);

        try {
          const tx = await messageTransmitter.receiveMessage(attestation.message, attestation.attestation);
          const receipt = await tx.wait();
          if (receipt && receipt.status !== 1) {
            throw new Error("Destination mint reverted.");
          }
          mintTxHash = receipt?.hash || tx.hash;
        } catch (relayError: any) {
          const message = String(relayError?.shortMessage || relayError?.message || relayError);
          /* Each CCTP nonce mints once. A revert on an already-spent nonce means the money is already
             where it should be, usually because a previous attempt landed but we lost the receipt. */
          if (!isAlreadyMintedError(message)) throw relayError;
          console.warn(`[CCTP Worker] ${item.id} was already minted on ${chainName}; recording as complete.`);
          mintTxHash = item.burn_tx_hash;
        }
      }

      await pgQuery(
        `UPDATE cctp_bridge_transfers
            SET status = 'completed',
                mint_tx_hash = $2,
                error_message = NULL,
                updated_at = now()
          WHERE id = $1`,
        [item.id, mintTxHash],
      );

      const netUsdc = formatMicros(BigInt(item.net_amount_micros));
      if (item.direction === "inbound_deposit") {
        const isOriginArc = item.origin_chain_id === "arc" || item.origin_chain_id === "5042002" || item.origin_chain_id === "5042001";
        const originName = isOriginArc ? "Arc Network" : (CCTP_CONFIG[Number(item.origin_chain_id)]?.name || `Chain ${item.origin_chain_id}`);
        await notifyDepositArrived({
          recipientAddress: item.recipient_address,
          originChainName: originName,
          netUsdc,
        });
      } else {
        await notifyWithdrawalArrived({
          recipientAddress: item.user_wallet,
          destinationChainName: chainName,
          netUsdc,
        });
      }

      result.completed++;
      console.log(`[CCTP Worker] ${item.direction} ${item.id} completed on ${chainName} (${mintTxHash}).`);
    } catch (error: any) {
      const reason = String(error?.shortMessage || error?.message || error).slice(0, 500);
      const nextAttempt = item.attempt_count + 1;

      if (nextAttempt >= MAX_ATTEMPTS) {
        await markFailed(item, reason);
        result.failed++;
        continue;
      }

      /* Back to pending_attestation so the next tick re-reads the attestation and retries. The row
         keeps its attempt count, which is what eventually stops the loop. */
      await pgQuery(
        `UPDATE cctp_bridge_transfers
            SET status = 'pending_attestation',
                attempt_count = attempt_count + 1,
                error_message = $2,
                updated_at = now()
          WHERE id = $1`,
        [item.id, reason],
      );
      result.waiting++;
      console.error(`[CCTP Worker] ${item.id} attempt ${nextAttempt} failed: ${reason}`);
    }
  }

  return result;
}
