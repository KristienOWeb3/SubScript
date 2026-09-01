import { CCTP_IRIS_BASE_URL } from "@/lib/contracts/constants";

/* CCTP V2. The V1 four-argument form
     depositForBurn(uint256,uint32,bytes32,address)
   is a different selector and reverts on a V2 TokenMessenger. */
export const TOKEN_MESSENGER_V2_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
] as const;

/* receiveMessage lives on MessageTransmitterV2, never on the TokenMessenger. */
export const MESSAGE_TRANSMITTER_V2_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

/* 2000 = Finalized. Standard transfer: Circle charges no on-chain fee and maxFee can be zero.
   1000 would request a Fast Transfer, which needs a nonzero maxFee and would silently take a cut of
   the user's money on top of the protocol fee. */
export const FINALITY_THRESHOLD_STANDARD = 2000;

/* bytes32(0) lets anyone call receiveMessage, which is what allows our own relayer to complete the
   transfer without being named at burn time. */
export const ANY_DESTINATION_CALLER = `0x${"0".repeat(64)}` as `0x${string}`;

export interface CctpAttestation {
  status: string;
  attestation: `0x${string}`;
  message: `0x${string}`;
  eventNonce: string | null;
  cctpVersion: number | null;
  delayReason: string | null;
  mintRecipient: string | null;
  amountMicros: string | null;
}

/**
 * Fetch the attestation for a burn from Circle's Iris service.
 *
 * The V2 endpoint is `GET /v2/messages/{sourceDomainId}?transactionHash=0x…` and returns
 * `{ sourceTxHash, messages: [...] }`. It is keyed on the *burn transaction hash*, not on a message
 * hash, and sandbox and production are separate stores.
 *
 * Returns null while the attestation is still pending, which is the normal state for the first few
 * minutes after a burn. Throws only when the request itself is broken.
 */
export async function fetchCctpAttestation(params: {
  sourceDomain: number;
  burnTxHash: string;
  /* A burn tx can carry several messages. Match on the recipient when we know it. */
  expectedMintRecipient?: string | null;
  timeoutMs?: number;
}): Promise<CctpAttestation | null> {
  const url = `${CCTP_IRIS_BASE_URL}/v2/messages/${params.sourceDomain}?transactionHash=${encodeURIComponent(params.burnTxHash)}`;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(params.timeoutMs ?? 15_000),
  });

  /* 404 or 400 "not found" means Circle has not indexed the burn yet. Anything else is worth surfacing: a 429 in
     particular blocks every subsequent request for five minutes, so it must not look like
     "still pending". */
  if (response.status === 404) return null;
  if (response.status === 400) {
    const errorBody = await response.text().catch(() => "");
    if (errorBody.toLowerCase().includes("not found") || errorBody.toLowerCase().includes("pending")) {
      return null;
    }
    throw new Error(`Circle attestation service returned 400: ${errorBody.slice(0, 100)}`);
  }
  if (!response.ok) {
    throw new Error(`Circle attestation service returned ${response.status}.`);
  }

  const data = await response.json().catch(() => null);
  const messages: any[] = Array.isArray(data?.messages) ? data.messages : [];
  if (messages.length === 0) return null;

  const normalizeHexAddr = (val?: string | null) => (val || "").toLowerCase().replace(/^0x/, "").replace(/^0+/, "");
  const wanted = normalizeHexAddr(params.expectedMintRecipient);
  const match =
    (wanted
      ? messages.find(
          (m) => normalizeHexAddr(m?.decodedMessage?.decodedMessageBody?.mintRecipient) === wanted,
        )
      : undefined) ?? messages[0];

  /* `attestation` is the literal string "PENDING" until it is signed. */
  const attestation = typeof match?.attestation === "string" ? match.attestation : "";
  const message = typeof match?.message === "string" ? match.message : "";

  if (match?.status !== "complete") return null;
  if (!attestation.startsWith("0x") || attestation.length <= 2) return null;
  if (!message.startsWith("0x") || message.length <= 2) return null;

  return {
    status: match.status,
    attestation: attestation as `0x${string}`,
    message: message as `0x${string}`,
    eventNonce: match.eventNonce ?? null,
    cctpVersion: typeof match.cctpVersion === "number" ? match.cctpVersion : null,
    delayReason: match.delayReason ?? null,
    mintRecipient: match?.decodedMessage?.decodedMessageBody?.mintRecipient ?? null,
    amountMicros: match?.decodedMessage?.decodedMessageBody?.amount ?? null,
  };
}

/**
 * Left-pads an EVM address to the bytes32 `mintRecipient` CCTP expects.
 */
export function addressToBytes32(address: string): `0x${string}` {
  const clean = address.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Not a valid EVM address: ${address}`);
  }
  return `0x${clean.padStart(64, "0")}` as `0x${string}`;
}

/**
 * True when a failed relay is an already-minted nonce rather than a real problem. CCTP allows each
 * nonce to be redeemed once, so a duplicate relay reverts; treating that as success is what stops
 * the keeper from retrying a finished transfer forever.
 */
export function isAlreadyMintedError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("nonce already used") ||
    text.includes("message already received") ||
    text.includes("already used") ||
    text.includes("nonce mismatch") ||
    text.includes("message already executed") ||
    text.includes("nonce already executed") ||
    text.includes("already processed") ||
    text.includes("already minted") ||
    text.includes("duplicate message") ||
    text.includes("message already consumed") ||
    text.includes("0x3c2c1c0a") ||
    text.includes("0x82b42900")
  );
}

