import { ethers } from "ethers";
import {
    USDC_NATIVE_GAS_ADDRESS,
    ARC_TESTNET_CHAIN_ID,
    ARC_MAINNET_CHAIN_ID,
    isProd,
} from "@/lib/contracts/constants";
import { getArcRpcUrl } from "@/lib/cctp/relayer";
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
    /* Mainnet vs testnet must follow the app-wide switch (NEXT_PUBLIC_ENVIRONMENT via `isProd`), NOT
       NODE_ENV: a mainnet dev/preview server runs with NODE_ENV="development" yet must read the Arc
       *mainnet* explorer — otherwise external deposits are queried on the wrong network and never show. */
    const chainId = isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;
    const networkName = isProd ? "Arc Mainnet" : "Arc Testnet";
    /* Arc is indexed by Etherscan's unified v2 API (chainid-scoped); the old arcscan.app host is dead.
       A self-hosted/Blockscout explorer can override via ARC_EXPLORER_API_URL ({base}/api?…); otherwise
       we use Etherscan v2, which needs ETHERSCAN_API_KEY. With neither, only the getLogs "just-now" net
       below runs — historical deposits won't appear until a key (or custom explorer) is configured. */
    const explorerApiKey = process.env.ETHERSCAN_API_KEY || process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY || "";
    const customExplorer = process.env.ARC_EXPLORER_API_URL || "";
    const buildExplorerUrl = (params: Record<string, string>): string | null => {
        const qs = new URLSearchParams(params);
        if (customExplorer) return `${customExplorer.replace(/\/$/, "")}/api?${qs.toString()}`;
        if (!explorerApiKey) return null;
        qs.set("chainid", String(chainId));
        qs.set("apikey", explorerApiKey);
        return `https://api.etherscan.io/v2/api?${qs.toString()}`;
    };
    /* Reuse the app's canonical Arc RPC (ARC_RPC_URL / NEXT_PUBLIC_ARC_RPC_PRIMARY, arc.io defaults) so
       the getLogs net hits a working endpoint instead of the stale rpc.mainnet.arc.network host. */
    const rpcUrl = getArcRpcUrl();

    const targetContract = USDC_NATIVE_GAS_ADDRESS.toLowerCase();
    /* On Arc, USDC is the native gas token: external sends are NATIVE value transfers whose ERC-20
       Transfer event is emitted by the native precompile below, NOT by USDC_NATIVE_GAS_ADDRESS (0x36…).
       The getLogs net must watch the precompile, and its Transfer `data` is 18-decimal (÷1e12 → micros). */
    const NATIVE_TOKEN_EVENT_ADDRESS = "0x" + "f".repeat(39) + "e";
    const deposits: ArcDepositItem[] = [];
    let fetchSucceeded = false;

    // Strategy 1: Explorer API (Etherscan v2, indexed, full history — includes native value transfers)
    const tokenTxUrl = buildExplorerUrl({ module: "account", action: "tokentx", address: normalizedWallet, contractaddress: targetContract, page: "1", offset: "50", sort: "desc" });
    const txListUrl = buildExplorerUrl({ module: "account", action: "txlist", address: normalizedWallet, page: "1", offset: "50", sort: "desc" });
    try {
        const [tokenRes, txListRes] = await Promise.allSettled([
            tokenTxUrl ? fetch(tokenTxUrl, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }) : Promise.reject(new Error("no explorer configured")),
            txListUrl ? fetch(txListUrl, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }) : Promise.reject(new Error("no explorer configured")),
        ]);

        if (tokenRes.status === "fulfilled" && tokenRes.value.ok) {
            const data = await tokenRes.value.json().catch(() => null);
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
                    /* Normalize the token's smallest unit to 6-decimal USDC micros using the decimals
                       Etherscan reports. Arc's USDC ERC-20 (USDC_NATIVE_GAS_ADDRESS) is 6-decimal, so
                       this is a no-op there; keying off tokenDecimal keeps the amount correct even if
                       the explorer denominates it at the 18-decimal native-gas scale, instead of
                       silently inflating it 1e12×. */
                    const rawValue = BigInt(itemValueStr);
                    const rawDecimals = Number(item.tokenDecimal);
                    const tokenDecimals = Number.isInteger(rawDecimals) && rawDecimals >= 0 && rawDecimals <= 36 ? rawDecimals : 6;
                    const microsBigInt = tokenDecimals >= 6
                        ? rawValue / 10n ** BigInt(tokenDecimals - 6)
                        : rawValue * 10n ** BigInt(6 - tokenDecimals);
                    if (microsBigInt <= 0n) continue;
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
                            amountUsdc: microsBigInt.toString(),
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

        // Parse native gas transactions (txlist) from external wallets
        if (txListRes.status === "fulfilled" && txListRes.value.ok) {
            const data = await txListRes.value.json().catch(() => null);
            if (data && (data.status === "1" || Array.isArray(data.result))) {
                const results = Array.isArray(data.result) ? data.result : [];
                for (const item of results) {
                    if (item.isError === "1" || item.txreceipt_status === "0") continue;
                    const itemTo = String(item.to || "").toLowerCase();
                    const itemFrom = String(item.from || "").toLowerCase();
                    const itemValueStr = String(item.value || "0");

                    if (itemTo !== normalizedWallet && itemFrom !== normalizedWallet) continue;
                    if (itemFrom === itemTo) continue;

                    let weiVal = 0n;
                    try {
                        weiVal = BigInt(itemValueStr);
                        if (weiVal <= 0n) continue;
                    } catch {
                        continue;
                    }

                    // On Arc, native gas is USDC with 18 decimals at RPC/EVM level. Convert 18 decimals to 6-decimal micros.
                    const microsBigInt = weiVal / 10n ** 12n;
                    if (microsBigInt <= 0n) continue;

                    const incoming = itemTo === normalizedWallet;
                    const direction: "inbound_deposit" | "outbound_send" = incoming ? "inbound_deposit" : "outbound_send";

                    const timeMs = Number(item.timeStamp) * 1000 || Date.now();
                    const blockNum = Number(item.blockNumber) || 0;
                    const whole = microsBigInt / 1_000_000n;
                    const fraction = (microsBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
                    const amountFormatted = `${whole.toString()}.${fraction}`;

                    const depositId = `arc-${direction}-${item.hash}`;
                    if (!deposits.some((d) => d.id === depositId || (d.txHash.toLowerCase() === item.hash.toLowerCase() && d.direction === direction))) {
                        deposits.push({
                            id: depositId,
                            txHash: item.hash,
                            fromAddress: itemFrom,
                            toAddress: itemTo,
                            amountUsdc: microsBigInt.toString(),
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
                signal: AbortSignal.timeout(10000),
            });

            if (blockRes.ok) {
                const blockJson = await blockRes.json();
                const latestBlock = parseInt(blockJson.result, 16);
                if (Number.isFinite(latestBlock) && latestBlock > 0) {
                    const fromBlockHex = "0x" + Math.max(0, latestBlock - 5000).toString(16);
                    
                    // Run incoming & outgoing log queries in parallel
                    const [inLogRes, outLogRes] = await Promise.all([
                        fetch(rpcUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                jsonrpc: "2.0",
                                method: "eth_getLogs",
                                params: [{
                                    address: NATIVE_TOKEN_EVENT_ADDRESS,
                                    topics: [TRANSFER_EVENT_TOPIC, null, paddedTo],
                                    fromBlock: fromBlockHex,
                                    toBlock: "latest",
                                }],
                                id: 2,
                            }),
                            signal: AbortSignal.timeout(12000),
                        }).catch(() => null),
                        fetch(rpcUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                jsonrpc: "2.0",
                                method: "eth_getLogs",
                                params: [{
                                    address: NATIVE_TOKEN_EVENT_ADDRESS,
                                    topics: [TRANSFER_EVENT_TOPIC, paddedFrom, null],
                                    fromBlock: fromBlockHex,
                                    toBlock: "latest",
                                }],
                                id: 3,
                            }),
                            signal: AbortSignal.timeout(12000),
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
                            const rawVal = BigInt(log.data || "0x0");
                            if (rawVal <= 0n) continue;
                            // Native precompile Transfer data is 18-decimal; convert to 6-decimal USDC micros.
                            const microsBigInt = rawVal / 10n ** 12n;
                            if (microsBigInt <= 0n) continue;

                            const whole = microsBigInt / 1_000_000n;
                            const fraction = (microsBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
                            const amountFormatted = `${whole.toString()}.${fraction}`;
                            const txHash = log.transactionHash;
                            const direction = isIncoming ? "inbound_deposit" : "outbound_send";

                            if (!deposits.some((d) => d.txHash.toLowerCase() === txHash.toLowerCase())) {
                                deposits.push({
                                    id: `arc-${direction}-${txHash}`,
                                    txHash,
                                    fromAddress: fromHex,
                                    toAddress: toHex,
                                    amountUsdc: microsBigInt.toString(),
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
