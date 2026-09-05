import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  AccountMeta,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { isProd, SOLANA_CCTP_CONFIG } from "@/lib/contracts/constants";
import { isAlreadyMintedError } from "./circleBridge";

/* Base58 decode helper compatible with both CJS and ESM exports of bs58 */
function decodeBase58(str: string): Uint8Array {
  if (typeof bs58.decode === "function") {
    return bs58.decode(str.trim());
  }
  if ((bs58 as any).default && typeof (bs58 as any).default.decode === "function") {
    return (bs58 as any).default.decode(str.trim());
  }
  throw new Error("Unable to locate bs58 decode function");
}

/**
 * Returns the Solana relayer keypair from environment variables.
 */
export function getSolanaRelayerKeypair(): Keypair {
  const secretKey =
    process.env.SOLANA_RELAYER_PRIVATE_KEY ||
    process.env.SOLANA_PRIVATE_KEY;

  if (!secretKey || !secretKey.trim()) {
    throw new Error("No Solana relayer private key configured. Set SOLANA_RELAYER_PRIVATE_KEY.");
  }

  try {
    const decoded = decodeBase58(secretKey);
    return Keypair.fromSecretKey(decoded);
  } catch (error: any) {
    throw new Error(`Failed to decode SOLANA_RELAYER_PRIVATE_KEY: ${error?.message || error}`);
  }
}

/**
 * Returns the public address of the Solana relayer, or null if unconfigured.
 */
export function getSolanaRelayerAddress(): string | null {
  try {
    return getSolanaRelayerKeypair().publicKey.toBase58();
  } catch {
    const pub = process.env.SOLANA_RELAYER_PUBLIC_KEY;
    return pub && pub.trim() ? pub.trim() : null;
  }
}

/**
 * Creates a Connection to the configured Solana RPC endpoint.
 */
export function getSolanaConnection(): Connection {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    SOLANA_CCTP_CONFIG.defaultRpc;
  return new Connection(rpcUrl, { commitment: "confirmed" });
}

/* Fallback canonical fee recipient on Solana mainnet / devnet if RPC query is unavailable */
const DEFAULT_SOLANA_FEE_RECIPIENT = isProd
  ? "4BPnUzFDibVcWQ5zzixGodRUHwqDxHYpUPdPYus3Bn56"
  : "AYG63YgrKLbp9B23ntcRemU8kSD7rZ7cNFGDo8DbEfTd";

/**
 * Relays a finalized Circle CCTP attestation and message to MessageTransmitterV2 on Solana.
 *
 * Steps:
 * 1. Checks on-chain if the message nonce was already consumed (UsedNonce PDA).
 * 2. Idempotently creates the recipient's USDC Associated Token Account (ATA) if needed.
 * 3. Dynamically resolves CCTP V2 PDAs and constructs the receive_message instruction.
 * 4. Signs and submits via the dedicated SubScript Solana relayer.
 */
export async function relayCctpMintToSolana(params: {
  recipientAddress: string;
  messageBytes: string | Buffer;
  attestationBytes: string | Buffer;
}): Promise<{ signature: string }> {
  const connection = getSolanaConnection();
  const relayerKeypair = getSolanaRelayerKeypair();

  const message = Buffer.isBuffer(params.messageBytes)
    ? params.messageBytes
    : Buffer.from(params.messageBytes.replace(/^0x/, ""), "hex");

  const attestation = Buffer.isBuffer(params.attestationBytes)
    ? params.attestationBytes
    : Buffer.from(params.attestationBytes.replace(/^0x/, ""), "hex");

  if (message.length < 148) {
    throw new Error(`CCTP message buffer too short: ${message.length} bytes (expected >= 148)`);
  }

  /* CCTP V2 message offsets */
  const sourceDomain = message.readUInt32BE(4);
  const nonceBytes = message.subarray(12, 44);
  /* burn_token is at messageBody offset 4..36 (message offset 152..184) */
  const burnTokenBytes = message.subarray(152, 184);

  const msgTransmitterProg = new PublicKey(SOLANA_CCTP_CONFIG.messageTransmitterProgramId);
  const tokenMinterProg = new PublicKey(SOLANA_CCTP_CONFIG.tokenMessengerMinterProgramId);
  const usdcMint = new PublicKey(SOLANA_CCTP_CONFIG.usdcMint);

  /* Derive MessageTransmitter PDAs */
  const [messageTransmitterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter")],
    msgTransmitterProg,
  );
  const [authorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter_authority"), tokenMinterProg.toBuffer()],
    msgTransmitterProg,
  );
  const [usedNoncePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("used_nonce"), nonceBytes],
    msgTransmitterProg,
  );

  /* Fast check: If used_nonce PDA already exists on-chain, transfer was already minted! */
  try {
    const nonceInfo = await connection.getAccountInfo(usedNoncePda);
    if (nonceInfo !== null) {
      console.log(`[Solana Relayer] Nonce ${usedNoncePda.toBase58()} already consumed on Solana; marking complete.`);
      return { signature: "already_minted" };
    }
  } catch (err: any) {
    console.warn(`[Solana Relayer] Nonce check error (proceeding to tx):`, err?.message);
  }

  /* Derive TokenMessengerMinter PDAs */
  const [tokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_messenger")],
    tokenMinterProg,
  );
  const domainBuf = Buffer.alloc(4);
  domainBuf.writeUInt32BE(sourceDomain);
  const [remoteTokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("remote_token_messenger"), domainBuf],
    tokenMinterProg,
  );
  const [tokenMinterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_minter")],
    tokenMinterProg,
  );
  const [localTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("local_token"), usdcMint.toBuffer()],
    tokenMinterProg,
  );
  const [tokenPairPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_pair"), Buffer.from(sourceDomain.toString()), burnTokenBytes],
    tokenMinterProg,
  );
  const [custodyTokenAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("custody"), usdcMint.toBuffer()],
    tokenMinterProg,
  );
  const [tokenMessengerEventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    tokenMinterProg,
  );

  /* Resolve feeRecipient token account */
  let feeRecipientPubkey = new PublicKey(DEFAULT_SOLANA_FEE_RECIPIENT);
  try {
    const tmInfo = await connection.getAccountInfo(tokenMessengerPda);
    if (tmInfo && tmInfo.data.length >= 141) {
      feeRecipientPubkey = new PublicKey(tmInfo.data.subarray(109, 141));
    }
  } catch (err: any) {
    console.warn("[Solana Relayer] Could not read dynamic fee_recipient, using canonical fallback:", err?.message);
  }
  const feeRecipientTokenAccount = getAssociatedTokenAddressSync(usdcMint, feeRecipientPubkey, true);

  /* Resolve recipient token account */
  const recipientRaw = new PublicKey(params.recipientAddress.trim());
  let recipientAta: PublicKey;
  let recipientWallet: PublicKey | null = null;

  if (PublicKey.isOnCurve(recipientRaw.toBytes())) {
    /* User specified standard wallet address on curve */
    recipientWallet = recipientRaw;
    recipientAta = getAssociatedTokenAddressSync(usdcMint, recipientWallet, true);
  } else {
    /* User specified an off-curve account (already an ATA) */
    recipientAta = recipientRaw;
  }

  const tx = new Transaction();

  /* Compute budget: 300,000 compute units is plenty for receiveMessage CPI */
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));

  /* If recipient wallet is known, idempotently ensure its USDC ATA exists */
  if (recipientWallet) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        relayerKeypair.publicKey,
        recipientAta,
        recipientWallet,
        usdcMint,
      ),
    );
  }

  /* Construct receive_message instruction */
  // 8-byte Anchor discriminator: sha256("global:receive_message").slice(0, 8)
  const discriminator = Buffer.from("26907fe11fe1ee19", "hex");
  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32LE(message.length, 0);
  const attLenBuf = Buffer.alloc(4);
  attLenBuf.writeUInt32LE(attestation.length, 0);
  const instructionData = Buffer.concat([
    discriminator,
    msgLenBuf,
    message,
    attLenBuf,
    attestation,
  ]);

  const keys: AccountMeta[] = [
    { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
    { pubkey: authorityPda, isSigner: false, isWritable: false },
    { pubkey: messageTransmitterPda, isSigner: false, isWritable: false },
    { pubkey: usedNoncePda, isSigner: false, isWritable: true },
    { pubkey: tokenMinterProg, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // Remaining accounts forwarded via CPI to TokenMessengerMinterV2:
    { pubkey: tokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: remoteTokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: tokenMinterPda, isSigner: false, isWritable: true },
    { pubkey: localTokenPda, isSigner: false, isWritable: true },
    { pubkey: tokenPairPda, isSigner: false, isWritable: false },
    { pubkey: feeRecipientTokenAccount, isSigner: false, isWritable: true },
    { pubkey: recipientAta, isSigner: false, isWritable: true },
    { pubkey: custodyTokenAccountPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tokenMessengerEventAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: tokenMinterProg, isSigner: false, isWritable: false },
  ];

  tx.add(
    new TransactionInstruction({
      programId: msgTransmitterProg,
      keys,
      data: instructionData,
    }),
  );

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [relayerKeypair], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    console.log(`[Solana Relayer] receiveMessage confirmed: ${signature}`);
    return { signature };
  } catch (relayError: any) {
    const msg = String(relayError?.message || relayError);
    if (isAlreadyMintedError(msg)) {
      console.warn(`[Solana Relayer] Nonce was already minted (${msg}); treating as success.`);
      return { signature: "already_minted" };
    }
    throw relayError;
  }
}
