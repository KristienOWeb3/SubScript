import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { decryptPrivateKey } from "@/lib/crypto";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { withPgClient } from "@/lib/serverPg";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { sanitizeInput } from "@/utils/security";

export const maxDuration = 120;

type SendRecipient = {
    receiverAddress: string;
    amountUsdc: unknown;
    title?: string;
    description?: string;
};

type EmbeddedWalletRecord = {
    encrypted_private_key: string | null;
    provider: string | null;
};

function rpcEndpoints() {
    return Array.from(new Set([
        process.env.ARC_RPC_PRIMARY,
        process.env.ARC_RPC_SECONDARY,
        process.env.RPC_URL,
        process.env.RPC_FALLBACK_URL_1,
        process.env.RPC_FALLBACK_URL_2,
        "https://rpc.testnet.arc.network",
    ].filter(Boolean) as string[]));
}

async function getProvider() {
    let lastError: unknown = null;
    for (const url of rpcEndpoints()) {
        try {
            const provider = new ethers.JsonRpcProvider(url);
            await provider.getNetwork();
            return provider;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("No Arc RPC endpoint is available");
}

function formatAmount(amountMicros: bigint) {
    const microsPerUsdc = BigInt(1_000_000);
    const whole = amountMicros / microsPerUsdc;
    const fraction = (amountMicros % microsPerUsdc).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

function normalizeRecipients(body: any): SendRecipient[] {
    if (Array.isArray(body?.recipients)) {
        return body.recipients.map((item: any) => ({
            receiverAddress: item?.receiverAddress || item?.address,
            amountUsdc: item?.amountUsdc || item?.amount,
            title: item?.title,
            description: item?.description,
        }));
    }

    return [{
        receiverAddress: body?.receiverAddress,
        amountUsdc: body?.amountUsdc,
        title: body?.title,
        description: body?.description,
    }];
}

async function logTransfer(client: any, sender: string, receiver: string, amountMicros: bigint, txHash: string, title?: string, description?: string) {
    await client.query(
        `insert into customers (wallet_address)
         values ($1), ($2)
         on conflict (wallet_address) do nothing`,
        [sender, receiver]
    );

    await client.query(
        `insert into subscript_dms (
            sender_address,
            receiver_address,
            message_type,
            status,
            amount_usdc,
            title,
            description,
            tx_hash
        ) values ($1, $2, 'PEER_TRANSFER', 'APPROVED', $3, $4, $5, $6)`,
        [
            sender,
            receiver,
            amountMicros.toString(),
            title || `${formatAmount(amountMicros)} USDC Sent`,
            description || `Direct transfer of ${formatAmount(amountMicros)} USDC on-chain.`,
            txHash.toLowerCase(),
        ]
    );
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const normalizedSender = wallet.toLowerCase();
        const recipients = normalizeRecipients(body);
        if (recipients.length === 0 || recipients.length > 25) {
            return NextResponse.json({ error: "Provide between 1 and 25 recipients" }, { status: 400 });
        }

        const parsedRecipients = recipients.map((item, index) => {
            if (!item.receiverAddress || !ethers.isAddress(item.receiverAddress)) {
                throw new Error(`Recipient ${index + 1} has an invalid address`);
            }
            const receiver = item.receiverAddress.toLowerCase();
            if (receiver === normalizedSender) {
                throw new Error("You cannot send USDC to your own connected wallet.");
            }
            const amountMicros = parseUsdcToMicros(item.amountUsdc);
            if (amountMicros <= BigInt(0)) {
                throw new Error(`Recipient ${index + 1} has an invalid amount`);
            }
            return {
                receiver,
                amountMicros,
                title: item.title,
                description: item.description,
            };
        });

        const walletRecord = await withPgClient(async (client) => {
            const result = await client.query(
                `select encrypted_private_key, provider
                   from user_embedded_wallets
                  where wallet_address = $1
                  limit 1`,
                [normalizedSender]
            );
            return result.rows[0] as EmbeddedWalletRecord | undefined;
        });

        if (!walletRecord?.encrypted_private_key) {
            return NextResponse.json({
                error: "This action needs a browser wallet signature. Generated email wallets can send from here only when their encrypted key backup exists.",
            }, { status: 409 });
        }

        const privateKey = decryptPrivateKey(walletRecord.encrypted_private_key);
        const provider = await getProvider();
        const signer = new ethers.Wallet(privateKey, provider);
        if (signer.address.toLowerCase() !== normalizedSender) {
            return NextResponse.json({ error: "Stored wallet key does not match your active session wallet" }, { status: 409 });
        }

        const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, USDC_ERC20_ABI, signer);
        const txs: { receiverAddress: string; amountUsdc: string; txHash: string }[] = [];

        for (const item of parsedRecipients) {
            const tx = await usdc.transfer(item.receiver, item.amountMicros);
            const receipt = await tx.wait();
            if (!receipt || receipt.status !== 1) {
                throw new Error(`Transfer to ${item.receiver} reverted on-chain`);
            }

            await withPgClient(async (client) => {
                await logTransfer(client, normalizedSender, item.receiver, item.amountMicros, tx.hash, item.title, item.description);
            });

            txs.push({
                receiverAddress: item.receiver,
                amountUsdc: formatAmount(item.amountMicros),
                txHash: tx.hash,
            });
        }

        return NextResponse.json({
            success: true,
            transfers: txs,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Embedded wallet send failed:", error);
        return NextResponse.json({ error: error.message || "Failed to send USDC" }, { status: 500 });
    }
}
