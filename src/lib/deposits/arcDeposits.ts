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
    receiverName?: string | null;
    tokenSymbol: string;
    tokenAddress: string;
    chainId: number;
    network: string;
    direction: "inbound_deposit" | "outbound_send";
    incoming: boolean;
    isCctp?: boolean;
    originChainId?: number;
    originName?: string;
}

const TRANSFER_EVENT_TOPIC = ethers.id("Transfer(address,address,uint256)");

/**
 * Fetch incoming deposits and outgoing sends of native USDC on Arc Network for a given wallet address.
 * Only transfers of native USDC (USDC_NATIVE_GAS_ADDRESS) on Arc Network are returned.
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
                    // Strict filtering: ONLY USDC transfers on Arc Network
                    const itemContract = String(item.contractAddress || "").toLowerCase();
                    const itemTo = String(item.to || "").toLowerCase();
                    const itemFrom = String(item.from || "").toLowerCase();
                    const itemSymbol = String(item.tokenSymbol || "").toUpperCase();
                    const itemValueStr = String(item.value || "0");

                    // Must be native USDC contract on Arc
                    if (itemContract !== targetContract) continue;
                    // Must involve the user's wallet
                    if (itemTo !== normalizedWallet && itemFrom !== normalizedWallet) continue;
                    // Skip self-transfers
                    if (itemFrom === itemTo) continue;
                    // Must have a positive value
                    try {
                        if (BigInt(itemValueStr) <= 0n) continue;
                    } catch {
                        continue;
                    }
                    // Must be USDC
                    if (itemSymbol && itemSymbol !== "USDC") continue;

                    const incoming = itemTo === normalizedWallet;
                    const direction: "inbound_deposit" | "outbound_send" = incoming ? "inbound_deposit" : "outbound_send";

                    const timeMs = Number(item.timeStamp) * 1000 || Date.now();
                    const blockNum = Number(item.blockNumber) || 0;
                    const microsBigInt = BigInt(itemValueStr);
                    const whole = microsBigInt / 1_000_000n;
                    const fraction = (microsBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
                    const amountFormatted = `${whole.toString()}.${fraction}`;

                    const depositId = `arc-${direction}-${item.hash}${item.logIndex ? `-${item.logIndex}` : ""}`;
                    if (!deposits.some((d) => d.id === depositId || (d.txHash.toLowerCase() === item.hash.toLowerCase() && d.direction === direction))) {
                        deposits.push({
                            id: depositId,
                            txHash: item.hash,
                            fromAddress: itemFrom,
                            toAddress: itemTo,
                            amountUsdc: itemValueStr,
                            amountFormatted,
                            timestamp: timeMs,
                            blockNumber: blockNum,
                            status: "COMPLETED",
                            senderName: null,
                            receiverName: null,
                            tokenSymbol: "USDC",
                            tokenAddress: targetContract,
                            chainId,
                            network: networkName,
                            direction,
                            incoming,
                        });
                    }
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
            const paddedFrom = ethers.zeroPadValue(normalizedWallet, 32);
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
                    
                    // Run incoming & outgoing log queries in parallel
                    const [inLogRes, outLogRes] = await Promise.all([
                        fetch(rpcUrl, {
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
                        }).catch(() => null),
                        fetch(rpcUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                jsonrpc: "2.0",
                                method: "eth_getLogs",
                                params: [{
                                    address: targetContract,
                                    topics: [TRANSFER_EVENT_TOPIC, paddedFrom, null],
                                    fromBlock: fromBlockHex,
                                    toBlock: "latest",
                                }],
                                id: 3,
                            }),
                            signal: AbortSignal.timeout(5000),
                        }).catch(() => null),
                    ]);

                    const parseLogs = async (res: Response | null, isIncoming: boolean) => {
                        if (!res || !res.ok) return;
                        const logJson = await res.json().catch(() => ({}));
                        const rawLogs = Array.isArray(logJson.result) ? logJson.result : [];
                        for (const log of rawLogs) {
                            if (!log.topics || log.topics.length < 3) continue;
                            const fromHex = ethers.dataSlice(log.topics[1], 12).toLowerCase();
                            const toHex = ethers.dataSlice(log.topics[2], 12).toLowerCase();
                            if (fromHex === toHex) continue;
                            const valBigInt = BigInt(log.data || "0x0");
                            if (valBigInt <= 0n) continue;

                            const whole = valBigInt / 1_000_000n;
                            const fraction = (valBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
                            const amountFormatted = `${whole.toString()}.${fraction}`;
                            const txHash = log.transactionHash;
                            const direction = isIncoming ? "inbound_deposit" : "outbound_send";

                            if (!deposits.some((d) => d.txHash.toLowerCase() === txHash.toLowerCase())) {
                                deposits.push({
                                    id: `arc-${direction}-${txHash}`,
                                    txHash,
                                    fromAddress: fromHex,
                                    toAddress: toHex,
                                    amountUsdc: valBigInt.toString(),
                                    amountFormatted,
                                    timestamp: Date.now(),
                                    blockNumber: parseInt(log.blockNumber, 16) || latestBlock,
                                    status: "COMPLETED",
                                    senderName: null,
                                    receiverName: null,
                                    tokenSymbol: "USDC",
                                    tokenAddress: targetContract,
                                    chainId,
                                    network: networkName,
                                    direction,
                                    incoming: isIncoming,
                                });
                            }
                        }
                    };

                    await Promise.all([parseLogs(inLogRes, true), parseLogs(outLogRes, false)]);
                }
            }
        } catch (rpcErr) {
            console.warn("[arcDeposits] RPC fallback also failed:", rpcErr);
        }
    }

    // Enrich CCTP mint transactions (where fromAddress is 0x0000...0000)
    const zeroAddrDeposits = deposits.filter(
        (d) => !d.fromAddress || d.fromAddress === "0x0000000000000000000000000000000000000000"
    );
    if (zeroAddrDeposits.length > 0) {
        try {
            const txHashes = zeroAddrDeposits.map((d) => d.txHash.toLowerCase());
            const cctpMatches = await prisma.$queryRaw<Array<{
                mint_tx_hash: string | null;
                user_wallet: string;
                origin_chain_id: string;
            }>>`
                SELECT mint_tx_hash, user_wallet, origin_chain_id
                  FROM cctp_bridge_transfers
                 WHERE lower(mint_tx_hash) = ANY(${txHashes})
                 ORDER BY created_at DESC
            `;
            const cctpMap = new Map((cctpMatches || []).map((c) => [c.mint_tx_hash?.toLowerCase() || "", c]));
            for (const d of zeroAddrDeposits) {
                const match = cctpMap.get(d.txHash.toLowerCase());
                if (match && match.user_wallet) {
                    d.fromAddress = match.user_wallet;
                    d.isCctp = true;
                    d.originChainId = Number(match.origin_chain_id) || undefined;
                } else {
                    d.fromAddress = normalizedWallet;
                    d.isCctp = true;
                }
            }
        } catch {
            for (const d of zeroAddrDeposits) {
                d.fromAddress = normalizedWallet;
                d.isCctp = true;
            }
        }
    }

    // Resolve counterparty aliases in bulk if transfers exist
    if (deposits.length > 0) {
        try {
            const counterpartyAddresses = Array.from(new Set(deposits.map((d) => d.incoming ? d.fromAddress : d.toAddress)));
            const aliases = await prisma.addressAlias.findMany({
                where: {
                    address: { in: counterpartyAddresses },
                    isAnonymous: false,
                },
                select: { address: true, alias: true },
            });
            const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));
            for (const d of deposits) {
                const target = d.incoming ? d.fromAddress.toLowerCase() : d.toAddress.toLowerCase();
                const alias = aliasMap.get(target);
                if (alias) {
                    if (d.incoming) d.senderName = alias;
                    else d.receiverName = alias;
                }
            }
        } catch {
            // Best effort alias resolution
        }
    }

    // Sort descending by timestamp / blockNumber
    return deposits.sort((a, b) => b.timestamp - a.timestamp);
}
