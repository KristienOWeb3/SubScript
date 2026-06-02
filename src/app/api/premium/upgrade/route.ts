import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import {
    ARC_TESTNET_CHAIN_ID,
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS,
    PREMIUM_PLAN_ID,
    PREMIUM_PLAN_PRICE_USDC,
    SUBSCRIPT_ROUTER_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";

const PREMIUM_AMOUNT = ethers.parseUnits(PREMIUM_PLAN_PRICE_USDC, 6);
const PREMIUM_PERIOD_SECONDS = BigInt(2592000);

const ROUTER_INTERFACE = new ethers.Interface([
    "function depositAndCommit(bytes32 commitment, uint256 amount) external",
    "function verifyAndActivate(bytes32[] proof, bytes32 nullifierHash, address merchant, uint256 amount, uint256 period) external",
    "function setMerchantTier(address _merchant, uint8 _tier) external",
    "function merchantTiers(address) view returns (uint8)",
    "event Deposit(bytes32 indexed commitment, uint256 amount)",
    "event SubscriptionActivated(bytes32 indexed nullifierHash, address indexed merchant, uint256 amount, uint256 period)"
]);

const ERC20_INTERFACE = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

type PremiumUpgradeBody = {
    depositTxHash?: string;
    activationTxHash?: string;
    planId?: string;
    paymentRecipient?: string;
    proofData?: {
        commitment?: string;
        nullifierHash?: string;
        proof?: string[];
        amountRaw?: string;
        periodSeconds?: string;
    };
};

const isTxHash = (value: unknown): value is string =>
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

const isBytes32 = (value: unknown): value is string =>
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

const parseBody = async (request: Request): Promise<PremiumUpgradeBody | null> => {
    try {
        return await request.json();
    } catch {
        return null;
    }
};

const findTransfer = (
    receipt: ethers.TransactionReceipt,
    from: string,
    to: string,
    amount: bigint
) => {
    for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== normalizeAddress(USDC_NATIVE_GAS_ADDRESS)) continue;
        try {
            const parsed = ERC20_INTERFACE.parseLog(log);
            if (
                parsed?.name === "Transfer" &&
                normalizeAddress(parsed.args.from) === normalizeAddress(from) &&
                normalizeAddress(parsed.args.to) === normalizeAddress(to) &&
                BigInt(parsed.args.value) === amount
            ) {
                return true;
            }
        } catch {
        }
    }
    return false;
};

const findDeposit = (
    receipt: ethers.TransactionReceipt,
    commitment: string,
    amount: bigint
) => {
    for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== normalizeAddress(SUBSCRIPT_ROUTER_ADDRESS)) continue;
        try {
            const parsed = ROUTER_INTERFACE.parseLog(log);
            if (
                parsed?.name === "Deposit" &&
                String(parsed.args.commitment).toLowerCase() === commitment.toLowerCase() &&
                BigInt(parsed.args.amount) === amount
            ) {
                return true;
            }
        } catch {
        }
    }
    return false;
};

const findActivation = (
    receipt: ethers.TransactionReceipt,
    nullifierHash: string,
    merchant: string,
    amount: bigint,
    period: bigint
) => {
    for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== normalizeAddress(SUBSCRIPT_ROUTER_ADDRESS)) continue;
        try {
            const parsed = ROUTER_INTERFACE.parseLog(log);
            if (
                parsed?.name === "SubscriptionActivated" &&
                String(parsed.args.nullifierHash).toLowerCase() === nullifierHash.toLowerCase() &&
                normalizeAddress(parsed.args.merchant) === normalizeAddress(merchant) &&
                BigInt(parsed.args.amount) === amount &&
                BigInt(parsed.args.period) === period
            ) {
                return true;
            }
        } catch {
        }
    }
    return false;
};

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please connect your wallet first." }, { status: 401 });
        }

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const { depositTxHash, activationTxHash, planId, paymentRecipient, proofData } = body;
        if (!isTxHash(depositTxHash) || !isTxHash(activationTxHash)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid premium transaction hashes" }, { status: 400 });
        }
        if (planId !== PREMIUM_PLAN_ID) {
            return NextResponse.json({ error: "Bad Request: Unsupported premium plan ID" }, { status: 400 });
        }
        if (!paymentRecipient || normalizeAddress(paymentRecipient) !== normalizeAddress(PREMIUM_PAYMENT_RECIPIENT_ADDRESS)) {
            return NextResponse.json({ error: "Bad Request: Incorrect premium payment recipient" }, { status: 400 });
        }
        if (
            !proofData ||
            !isBytes32(proofData.commitment) ||
            !isBytes32(proofData.nullifierHash) ||
            !Array.isArray(proofData.proof) ||
            proofData.proof.length < 2 ||
            proofData.proof.some((item) => !isBytes32(item)) ||
            BigInt(proofData.amountRaw || "0") !== PREMIUM_AMOUNT ||
            BigInt(proofData.periodSeconds || "0") !== PREMIUM_PERIOD_SECONDS
        ) {
            console.error("[Premium Upgrade] Invalid proof payload", { walletAddress, depositTxHash, activationTxHash });
            return NextResponse.json({ error: "Bad Request: Invalid premium proof payload" }, { status: 400 });
        }

        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(ARC_TESTNET_CHAIN_ID)) {
            return NextResponse.json({ error: `Network mismatch: expected Arc Testnet ${ARC_TESTNET_CHAIN_ID}, got ${network.chainId}` }, { status: 400 });
        }

        const [depositTx, activationTx, depositReceipt, activationReceipt] = await Promise.all([
            provider.getTransaction(depositTxHash),
            provider.getTransaction(activationTxHash),
            provider.getTransactionReceipt(depositTxHash),
            provider.getTransactionReceipt(activationTxHash)
        ]);

        if (!depositTx || !activationTx || !depositReceipt || !activationReceipt) {
            return NextResponse.json({ error: "Transaction receipt not found. Please try again in a few seconds." }, { status: 404 });
        }
        if (depositReceipt.status !== 1 || activationReceipt.status !== 1) {
            return NextResponse.json({ error: "Premium payment transaction failed or reverted on-chain" }, { status: 400 });
        }

        const authenticatedWallet = normalizeAddress(walletAddress);
        if (
            normalizeAddress(depositReceipt.from) !== authenticatedWallet ||
            normalizeAddress(activationReceipt.from) !== authenticatedWallet
        ) {
            return NextResponse.json({ error: "Forbidden: Transaction sender does not match connected wallet" }, { status: 403 });
        }
        if (
            !depositReceipt.to ||
            !activationReceipt.to ||
            normalizeAddress(depositReceipt.to) !== normalizeAddress(SUBSCRIPT_ROUTER_ADDRESS) ||
            normalizeAddress(activationReceipt.to) !== normalizeAddress(SUBSCRIPT_ROUTER_ADDRESS)
        ) {
            return NextResponse.json({ error: "Verification Failed: Premium router contract was not called" }, { status: 400 });
        }

        const parsedDepositTx = ROUTER_INTERFACE.parseTransaction({ data: depositTx.data, value: depositTx.value });
        const parsedActivationTx = ROUTER_INTERFACE.parseTransaction({ data: activationTx.data, value: activationTx.value });
        if (
            parsedDepositTx?.name !== "depositAndCommit" ||
            String(parsedDepositTx.args.commitment).toLowerCase() !== proofData.commitment.toLowerCase() ||
            BigInt(parsedDepositTx.args.amount) !== PREMIUM_AMOUNT
        ) {
            return NextResponse.json({ error: "Verification Failed: Deposit calldata does not match premium payment" }, { status: 400 });
        }
        if (
            parsedActivationTx?.name !== "verifyAndActivate" ||
            String(parsedActivationTx.args.nullifierHash).toLowerCase() !== proofData.nullifierHash.toLowerCase() ||
            normalizeAddress(parsedActivationTx.args.merchant) !== normalizeAddress(paymentRecipient) ||
            BigInt(parsedActivationTx.args.amount) !== PREMIUM_AMOUNT ||
            BigInt(parsedActivationTx.args.period) !== PREMIUM_PERIOD_SECONDS
        ) {
            return NextResponse.json({ error: "Verification Failed: Activation calldata does not match premium proof" }, { status: 400 });
        }

        if (!findTransfer(depositReceipt, walletAddress, SUBSCRIPT_ROUTER_ADDRESS, PREMIUM_AMOUNT)) {
            return NextResponse.json({ error: "Verification Failed: 10 USDC transfer to premium router not found" }, { status: 400 });
        }
        if (!findDeposit(depositReceipt, proofData.commitment, PREMIUM_AMOUNT)) {
            return NextResponse.json({ error: "Verification Failed: Premium deposit event not found" }, { status: 400 });
        }
        if (!findActivation(activationReceipt, proofData.nullifierHash, paymentRecipient, PREMIUM_AMOUNT, PREMIUM_PERIOD_SECONDS)) {
            return NextResponse.json({ error: "Verification Failed: Premium ZK activation event not found" }, { status: 400 });
        }

        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
        const contract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, ROUTER_INTERFACE, adminWallet);

        try {
            await contract.setMerchantTier.staticCall(walletAddress, 1);
        } catch (error: any) {
            console.error("[Premium Upgrade] Tier upgrade static call failed:", error);
            return NextResponse.json({ error: error.reason || error.shortMessage || error.message || "Premium tier upgrade access-control check failed" }, { status: 500 });
        }

        const upgradeTx = await contract.setMerchantTier(walletAddress, 1);
        const upgradeReceipt = await upgradeTx.wait();
        if (upgradeReceipt.status !== 1) {
            return NextResponse.json({ error: "On-chain admin upgrade transaction failed" }, { status: 500 });
        }

        const upgradedTier = await contract.merchantTiers(walletAddress);
        if (Number(upgradedTier) < 1) {
            return NextResponse.json({ error: "On-chain tier verification failed after upgrade" }, { status: 500 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (supabaseUrl && supabaseServiceKey) {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                const { error: dbError } = await supabase
                    .from("merchants")
                    .upsert({
                        wallet_address: walletAddress.toLowerCase(),
                        tier: 1
                    }, { onConflict: "wallet_address" });

                if (dbError) {
                    console.error("[Premium Upgrade] Database sync error:", dbError);
                    return NextResponse.json({ error: "Premium paid and upgraded on-chain, but database sync failed" }, { status: 500 });
                }
            } catch (dbErr) {
                console.error("[Premium Upgrade] Database client error:", dbErr);
                return NextResponse.json({ error: "Premium paid and upgraded on-chain, but database sync failed" }, { status: 500 });
            }
        }

        return NextResponse.json({
            success: true,
            tier: 1,
            depositTxHash,
            activationTxHash,
            upgradeTxHash: upgradeTx.hash
        }, { status: 200 });
    } catch (error: any) {
        console.error("Premium upgrade error:", error);
        return NextResponse.json({ error: error.reason || error.shortMessage || error.message || "Internal Server Error" }, { status: 500 });
    }
}
