import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ARC_MEMO_CONTRACT_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { ARC_MEMO_INTERFACE, USDC_TRANSFER_FROM_INTERFACE, isReceiptId, receiptUrl } from "@/lib/arc/memo";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function parseBlock(value: unknown, fallback: number | "latest") {
    if (value === "latest") return "latest";
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function POST(request: Request) {
    try {
        const indexerSecret = process.env.RECEIPT_INDEXER_SECRET;
        if (indexerSecret && request.headers.get("x-indexer-secret") !== indexerSecret) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Supabase service client is not configured" }, { status: 500 });
        }

        const body = await request.json().catch(() => ({}));
        const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network");
        const latest = await provider.getBlockNumber();
        const fromBlock = parseBlock(body.fromBlock, Math.max(0, latest - 5000));
        const toBlock = parseBlock(body.toBlock, "latest");

        const logs = await provider.getLogs({
            address: ARC_MEMO_CONTRACT_ADDRESS,
            fromBlock,
            toBlock,
            topics: [ARC_MEMO_INTERFACE.getEvent("Memo")!.topicHash],
        });

        let indexed = 0;
        for (const log of logs) {
            const parsedMemo = ARC_MEMO_INTERFACE.parseLog({
                topics: log.topics as string[],
                data: log.data,
            });
            const receiptId = parsedMemo?.args.memo;
            if (!isReceiptId(receiptId)) continue;

            const txReceipt = await provider.getTransactionReceipt(log.transactionHash);
            if (!txReceipt || txReceipt.status !== 1) continue;

            let paymentTransfer: { payer: string; merchant: string; amount: bigint } | null = null;
            for (const receiptLog of txReceipt.logs) {
                if (receiptLog.address.toLowerCase() !== USDC_NATIVE_GAS_ADDRESS.toLowerCase()) continue;
                try {
                    const parsedTransfer = USDC_TRANSFER_FROM_INTERFACE.parseLog({
                        topics: receiptLog.topics as string[],
                        data: receiptLog.data,
                    });
                    if (parsedTransfer?.name === "Transfer") {
                        paymentTransfer = {
                            payer: parsedTransfer.args.from.toLowerCase(),
                            merchant: parsedTransfer.args.to.toLowerCase(),
                            amount: BigInt(parsedTransfer.args.value),
                        };
                        break;
                    }
                } catch {
                    /* Ignore non-Transfer logs from the token contract. */
                }
            }
            if (!paymentTransfer) continue;

            await supabaseAdmin
                .from("receipts")
                .upsert({
                    receipt_id: receiptId,
                    tx_hash: log.transactionHash.toLowerCase(),
                    chain_id: Number((await provider.getNetwork()).chainId),
                    memo_contract: ARC_MEMO_CONTRACT_ADDRESS.toLowerCase(),
                    payer_address: paymentTransfer.payer,
                    merchant_address: paymentTransfer.merchant,
                    amount_usdc: paymentTransfer.amount.toString(),
                    memo_note: receiptId,
                    share_url: receiptUrl(receiptId, request.headers.get("origin")),
                    status: "CONFIRMED",
                    block_number: log.blockNumber.toString(),
                    log_index: log.index,
                    confirmed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }, { onConflict: "receipt_id" });
            indexed++;
        }

        return NextResponse.json({ success: true, indexed, scanned: logs.length });
    } catch (error: any) {
        console.error("Receipt indexer error:", error);
        return NextResponse.json({ error: error.message || "Receipt indexing failed" }, { status: 500 });
    }
}
