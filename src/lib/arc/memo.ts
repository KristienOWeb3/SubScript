import { Interface } from "ethers";
import { encodeFunctionData, type Hex } from "viem";
import { ARC_MEMO_CONTRACT_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";

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

export function slugifyReceiptTitle(title: string) {
    return title
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "SubScript-Receipt";
}

export function generateReceiptId(title: string) {
    const suffix = crypto.getRandomValues(new Uint8Array(2));
    const hex = Array.from(suffix, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${slugifyReceiptTitle(title)}-${hex}`;
}

export function buildMemoWrappedUsdcTransferFrom(args: {
    payer: `0x${string}`;
    merchant: `0x${string}`;
    amountUsdc: bigint;
    receiptId: string;
}) {
    const transferFromData = encodeFunctionData({
        abi: USDC_ERC20_ABI,
        functionName: "transferFrom",
        args: [args.payer, args.merchant, args.amountUsdc],
    });

    const memoData = encodeFunctionData({
        abi: ARC_MEMO_ABI,
        functionName: "executeWithMemo",
        args: [USDC_NATIVE_GAS_ADDRESS, transferFromData, args.receiptId],
    });

    return {
        to: ARC_MEMO_CONTRACT_ADDRESS,
        data: memoData,
        target: USDC_NATIVE_GAS_ADDRESS,
        transferFromData,
    };
}

export function receiptUrl(receiptId: string, origin?: string | null) {
    const base = origin || process.env.NEXT_PUBLIC_APP_URL || "https://subscript.app";
    return `${base.replace(/\/$/, "")}/receipt/${encodeURIComponent(receiptId)}`;
}

export function isReceiptId(value: unknown): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]{2,80}$/.test(value);
}

export function asHex(value: string): Hex {
    if (!/^0x[0-9a-fA-F]*$/.test(value)) {
        throw new Error("Expected hex string");
    }
    return value as Hex;
}
