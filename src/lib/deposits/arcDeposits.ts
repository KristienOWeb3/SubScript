import { ethers } from "ethers";
import {
    USDC_NATIVE_GAS_ADDRESS,
    ARC_TESTNET_CHAIN_ID,
    ARC_MAINNET_CHAIN_ID,
} from "@/lib/contracts/constants";
import { prisma } from "@/lib/prisma";

export interface ArcDepositItem {
    id: string;
    txHash: string;
    fromAddress: string;
    toAddress: string;
    amountUsdc: string; // Raw micros string (e.g. "1000000" = 1 USDC)
    amountFormatted: string; // Formatted e.g. "1.00"
    timestamp: number; // Milliseconds timestamp
    blockNumber: number;
    status: "COMPLETED" | "CONFIRMED";
    senderName: string | null;
    tokenSymbol: string;
    tokenAddress: string;
    chainId: number;
    network: string;
}

const TRANSFER_EVENT_TOPIC = ethers.id("Transfer(address,address,uint256)");

/**
 * Fetch incoming USDC deposits strictly on Arc Network for a given wallet address.
 * Only deposits of native USDC (USDC_NATIVE_GAS_ADDRESS) on Arc Network are returned.
 */
export async function fetchArcUsdcDeposits(walletAddress: string): Promise<ArcDepositItem[]> {
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
        return [];
    }

    const normalizedWallet = walletAddress.toLowerCase();
    const isProd = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
    const chainId = isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;
    const networkName = isProd ? "Arc Mainnet" : "Arc Testnet";
    const explorerBaseUrl = isProd ? "https://arcscan.app" : "https://testnet.arcscan.app";
    const rpcUrl = isProd
        ? (process.env.ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.network")
        : (process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network");

    const targetContract = USDC_NATIVE_GAS_ADDRESS.toLowerCase();
    const deposits: ArcDepositItem[] = [];
    let fetchSucceeded = false;

    // Strategy 1: Arcscan Explorer API (Fast, indexed, historical)
    try {
        const apiUrl = `${explorerBaseUrl}/api?module=account&action=tokentx&address=${normalizedWallet}&contractaddress=${targetContract}&page=1&offset=50&sort=desc`;
        const res = await fetch(apiUrl, {
            signal: AbortSignal.timeout(6000),
            headers: { Accept: "application/json" },
        });

        if (res.ok) {
            const data = await res.json();
            if (data && (data.status === "1" || Array.isArray(data.result))) {
                const results = Array.isArray(data.result) ? data.result : [];
                for (const item of results) {
                    // Strict filtering: ONLY USDC deposits on Arc Network
                    const itemContract = String(item.contractAddress || "").toLowerCase();
                    const itemTo = String(item.to || "").toLowerCase();
                    const itemFrom = String(item.from || "").toLowerCase();
                    const itemSymbol = String(item.tokenSymbol || "").toUpperCase();
                    const itemValueStr = String(item.value || "0");

                    // Must be native USDC contract on Arc
                    if (itemContract !== targetContract) continue;
                    // Must be incoming to the user's wallet
                    if (itemTo !== normalizedWallet) continue;
                    // Must not be an outbound transfer or self-transfer
                    if (itemFrom === normalizedWallet) continue;
                    // Must have a positive value
                    try {
                        if (BigInt(itemValueStr) <= 0n) continue;
                    } catch {
                        continue;
                    }
                    // Must be USDC
                    if (itemSymbol && itemSymbol !== "USDC") continue;

                    const timeMs = Number(item.timeStamp) * 1000 || Date.now();
                    const blockNum = Number(item.blockNumber) || 0;
                    const microsBigInt = BigInt(itemValueStr);
                    const whole = microsBigInt / 1_000_000n;
                    const fraction = (microsBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
                    const amountFormatted = `${whole.toString()}.${fraction}`;

                    deposits.push({
                        id: `deposit-${item.hash}`,
                        txHash: item.hash,
                        fromAddress: itemFrom,
                        toAddress: itemTo,
                        amountUsdc: itemValueStr,
                        amountFormatted,
                        timestamp: timeMs,
                        blockNumber: blockNum,
                        status: "COMPLETED",
                        senderName: null,
                        tokenSymbol: "USDC",
                        tokenAddress: targetContract,
                        chainId,
                        network: networkName,
                    });
                }
                fetchSucceeded = true;
            }
        }
    } catch (explorerErr) {
        console.warn("[arcDeposits] Explorer API fetch failed, trying RPC fallback:", explorerErr);
    }

    // Strategy 2: RPC getLogs Fallback if explorer API is unavailable or returns 0 results
    if (!fetchSucceeded || deposits.length === 0) {
        try {
            const paddedTo = ethers.zeroPadValue(normalizedWallet, 32);
            // Query latest block
            const blockRes = await fetch(rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
                signal: AbortSignal.timeout(4000),
            });

            if (blockRes.ok) {
                const blockJson = await blockRes.json();
                const latestBlock = parseInt(blockJson.result, 16);
                if (Number.isFinite(latestBlock) && latestBlock > 0) {
                    const fromBlockHex = "0x" + Math.max(0, latestBlock - 50000).toString(16);
                    const logRes = await fetch(rpcUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            jsonrpc: "2.0",
                            method: "eth_getLogs",
                            params: [{
                                address: targetContract,
                                topics: [TRANSFER_EVENT_TOPIC, null, paddedTo],
                                fromBlock: fromBlockHex,
                                toBlock: "latest",
                            }],
                            id: 2,
                        }),
                        signal: AbortSignal.timeout(5000),
                    });

                    if (logRes.ok) {
                        const logJson = await logRes.json();
                        const rawLogs = Array.isArray(logJson.result) ? logJson.result : [];
                        for (const log of rawLogs) {
                            if (!log.topics || log.topics.length < 3) continue;
                            const fromHex = ethers.dataSlice(log.topics[1], 12).toLowerCase();
                            if (fromHex === normalizedWallet) continue;
                            const valBigInt = BigInt(log.data || "0x0");
                            if (valBigInt <= 0n) continue;

                            const whole = valBigInt / 1_000_000n;
                            const fraction = (valBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
                            const amountFormatted = `${whole.toString()}.${fraction}`;
                            const txHash = log.transactionHash;

                            if (!deposits.some((d) => d.txHash.toLowerCase() === txHash.toLowerCase())) {
                                deposits.push({
                                    id: `deposit-${txHash}`,
                                    txHash,
                                    fromAddress: fromHex,
                                    toAddress: normalizedWallet,
                                    amountUsdc: valBigInt.toString(),
                                    amountFormatted,
                                    timestamp: Date.now(),
                                    blockNumber: parseInt(log.blockNumber, 16) || latestBlock,
                                    status: "COMPLETED",
                                    senderName: null,
                                    tokenSymbol: "USDC",
                                    tokenAddress: targetContract,
                                    chainId,
                                    network: networkName,
                                });
                            }
                        }
                    }
                }
            }
        } catch (rpcErr) {
            console.warn("[arcDeposits] RPC fallback also failed:", rpcErr);
        }
    }

    // Resolve sender aliases in bulk if deposits exist
    if (deposits.length > 0) {
        try {
            const senderAddresses = Array.from(new Set(deposits.map((d) => d.fromAddress)));
            const aliases = await prisma.addressAlias.findMany({
                where: {
                    address: { in: senderAddresses },
                    isAnonymous: false,
                },
                select: { address: true, alias: true },
            });
            const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));
            for (const d of deposits) {
                const alias = aliasMap.get(d.fromAddress.toLowerCase());
                if (alias) d.senderName = alias;
            }
        } catch {
            // Best effort alias resolution
        }
    }

    // Sort descending by timestamp / blockNumber
    return deposits.sort((a, b) => b.timestamp - a.timestamp);
}
