import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";
import { ROUTER_DEPOSIT_INTERFACE, isReceiptId, receiptUrl } from "@/lib/arc/memo";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function parseBlock(value: unknown, fallback: number | "latest") {
    if (value === "latest") return "latest";
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function POST(request: Request) {
    try {
        const indexerSecret = process.env.RECEIPT_INDEXER_SECRET;
        if (!indexerSecret) {
            return NextResponse.json({ error: "Receipt indexer is not configured" }, { status: 503 });
        }
        if (request.headers.get("x-indexer-secret") !== indexerSecret) {
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
            address: SUBSCRIPT_ROUTER_ADDRESS,
            fromBlock,
            toBlock,
            topics: [ROUTER_DEPOSIT_INTERFACE.getEvent("DepositWithMemo")!.topicHash],
        });

        let indexed = 0;
        for (const log of logs) {
            const parsedDeposit = ROUTER_DEPOSIT_INTERFACE.parseLog({
                topics: log.topics as string[],
                data: log.data,
            });
            if (!parsedDeposit || parsedDeposit.name !== "DepositWithMemo") continue;
            const receiptId = parsedDeposit?.args.memo;
            if (!isReceiptId(receiptId)) continue;

            const txReceipt = await provider.getTransactionReceipt(log.transactionHash);
            if (!txReceipt || txReceipt.status !== 1) continue;

            const { data: existingReceipt, error: existingReceiptError } = await supabaseAdmin
                .from("receipts")
                .select("tx_hash, payer_address, merchant_address, amount_usdc")
                .eq("receipt_id", receiptId)
                .maybeSingle();
            if (existingReceiptError) throw new Error(existingReceiptError.message);
            if (existingReceipt) {
                const matches = existingReceipt.tx_hash?.toLowerCase() === log.transactionHash.toLowerCase()
                    && existingReceipt.payer_address?.toLowerCase() === parsedDeposit.args.payer.toLowerCase()
                    && existingReceipt.merchant_address?.toLowerCase() === parsedDeposit.args.merchant.toLowerCase()
                    && BigInt(existingReceipt.amount_usdc) === BigInt(parsedDeposit.args.amount);
                if (!matches) throw new Error(`Receipt ${receiptId} is already bound to a different settlement`);
                continue;
            }

            const { error: receiptInsertError } = await supabaseAdmin
                .from("receipts")
                .insert({
                    receipt_id: receiptId,
                    tx_hash: log.transactionHash.toLowerCase(),
                    chain_id: Number((await provider.getNetwork()).chainId),
                    memo_contract: SUBSCRIPT_ROUTER_ADDRESS.toLowerCase(),
                    payer_address: parsedDeposit.args.payer.toLowerCase(),
                    merchant_address: parsedDeposit.args.merchant.toLowerCase(),
                    amount_usdc: BigInt(parsedDeposit.args.amount).toString(),
                    memo_note: receiptId,
                    share_url: receiptUrl(receiptId, request.headers.get("origin")),
                    status: "CONFIRMED",
                    block_number: log.blockNumber.toString(),
                    log_index: log.index,
                    confirmed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            if (receiptInsertError) throw new Error(`Receipt conflict: ${receiptInsertError.message}`);
            indexed++;
        }

        return NextResponse.json({ success: true, indexed, scanned: logs.length });
    } catch (error: any) {
        console.error("Receipt indexer error:", error);
        return NextResponse.json({ error: error.message || "Receipt indexing failed" }, { status: 500 });
    }
}
