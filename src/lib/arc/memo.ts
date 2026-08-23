import { Interface } from "ethers";
import { encodeFunctionData, type Hex } from "viem";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";

export const ARC_MEMO_ABI = [
    {
        type: "function",
        name: "executeWithMemo",
        stateMutability: "payable",
        inputs: [
            { name: "target", type: "address" },
            { name: "data", type: "bytes" },
            { name: "memo", type: "string" },
        ],
        outputs: [{ name: "result", type: "bytes" }],
    },
    {
        type: "event",
        name: "Memo",
        anonymous: false,
        inputs: [
            { name: "sender", type: "address", indexed: true },
            { name: "target", type: "address", indexed: true },
            { name: "memoHash", type: "bytes32", indexed: true },
            { name: "memo", type: "string", indexed: false },
        ],
    },
] as const;

export const ARC_MEMO_INTERFACE = new Interface([
    "function executeWithMemo(address target, bytes data, string memo) payable returns (bytes result)",
    "event Memo(address indexed sender, address indexed target, bytes32 indexed memoHash, string memo)",
]);

export const USDC_TRANSFER_FROM_INTERFACE = new Interface([
    "function transferFrom(address from, address to, uint256 value) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const USDC_TRANSFER_INTERFACE = new Interface([
    "function transfer(address to, uint256 value) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export function slugifyReceiptTitle(title: string) {
    return title
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "SubScript-Receipt";
}

export function generateReceiptId(title: string) {
    void title;
    const token = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(token, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `rcpt-${hex}`;
}

export const ROUTER_DEPOSIT_ABI = [
    {
        type: "function",
        name: "depositForMerchant",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_merchant", type: "address" },
            { name: "_amount", type: "uint256" },
            { name: "_memo", type: "string" },
        ],
        outputs: [],
    },
] as const;

export const ROUTER_DEPOSIT_INTERFACE = new Interface([
    "function depositForMerchant(address _merchant, uint256 _amount, string _memo)",
    "event DepositWithMemo(address indexed payer, address indexed merchant, uint256 amount, string memo)",
]);

export function buildMerchantPaymentTx(args: {
    merchant: `0x${string}`;
    amountUsdc: bigint;
    receiptId: string;
}) {
    const depositData = encodeFunctionData({
        abi: ROUTER_DEPOSIT_ABI,
        functionName: "depositForMerchant",
        args: [args.merchant, args.amountUsdc, args.receiptId],
    });

    return {
        to: SUBSCRIPT_ROUTER_ADDRESS,
        data: depositData,
    };
}

export function receiptUrl(receiptId: string, _origin?: string | null) {
    // Receipt URLs must be derived from controlled configuration, never a caller supplied Origin header.
    const configuredBase = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://www.subscriptonarc.com";
    let base = configuredBase;
    try {
        const url = new URL(configuredBase);
        if (url.hostname === "subscriptonarc.com") {
            url.hostname = "www.subscriptonarc.com";
        }
        base = url.origin;
    } catch {
        base = configuredBase.replace(/\/$/, "");
    }
    return `${base.replace(/\/$/, "")}/receipt/${encodeURIComponent(receiptId)}`;
}

export function isReceiptId(value: unknown): value is string {
    return typeof value === "string" && /^rcpt-[0-9a-f]{32}$/.test(value);
}

export function asHex(value: string): Hex {
    if (!/^0x[0-9a-fA-F]*$/.test(value)) {
        throw new Error("Expected hex string");
    }
    return value as Hex;
}

/**
 * Returns the configured Platform Master Viewing Key for platform-level auditability
 * of Arc confidential / shielded transactions.
 */
export function getPlatformMasterViewingKey(): string | null {
    const key = process.env.PLATFORM_MASTER_VIEW_KEY || process.env.NEXT_PUBLIC_PLATFORM_VIEW_KEY;
    if (!key || !key.trim()) {
        return null;
    }
    return key.trim();
}

export interface ConfidentialMemoInput {
    receiptId: string;
    merchantViewKeyHash?: string | null;
    isShielded?: boolean;
}

/**
 * Constructs a confidential memo payload combining the receipt ID with optional Arc privacy markers
 * and merchant viewing key hashes for off-chain and platform-audited transaction tracking.
 */
export function buildConfidentialMemoPayload(input: ConfidentialMemoInput): string {
    const { receiptId, merchantViewKeyHash, isShielded } = input;
    if (!isReceiptId(receiptId)) {
        throw new Error("Invalid receiptId format for confidential memo payload");
    }
    if (!isShielded) {
        return receiptId;
    }
    const viewKeyRef = merchantViewKeyHash ? `:vk-${merchantViewKeyHash.slice(0, 10)}` : "";
    return `arc-shielded:${receiptId}${viewKeyRef}`;
}

export interface ParsedConfidentialMemo {
    receiptId: string | null;
    isShielded: boolean;
    merchantViewKeyHashRef: string | null;
}

/**
 * Parses a memo string (standard or confidential) to extract the receipt ID and privacy metadata.
 */
export function parseConfidentialMemoPayload(memo: string | null | undefined): ParsedConfidentialMemo {
    if (!memo || typeof memo !== "string") {
        return { receiptId: null, isShielded: false, merchantViewKeyHashRef: null };
    }
    const trimmed = memo.trim();

    if (/^rcpt-[0-9a-f]{32}$/.test(trimmed)) {
        return { receiptId: trimmed, isShielded: false, merchantViewKeyHashRef: null };
    }

    if (trimmed.startsWith("arc-shielded:")) {
        const payload = trimmed.replace("arc-shielded:", "");
        const parts = payload.split(":vk-");
        const receiptId = /^rcpt-[0-9a-f]{32}$/.test(parts[0]) ? parts[0] : null;
        const merchantViewKeyHashRef = parts[1] || null;
        return {
            receiptId,
            isShielded: true,
            merchantViewKeyHashRef,
        };
    }

    // Direct search for rcpt- pattern within raw string
    const match = trimmed.match(/(rcpt-[0-9a-f]{32})/);
    return {
        receiptId: match ? match[1] : null,
        isShielded: trimmed.includes("shielded") || trimmed.includes("arc-shielded"),
        merchantViewKeyHashRef: null,
    };
}

