/* Server-side Permit2 authorization for an EMBEDDED-wallet merchant (the only kind now). Since the
   merchant has no browser wallet to sign with, the server: (1) approves USDC -> Permit2 once on its
   behalf (gas sponsored), (2) reads the current on-chain Permit2 nonce, and (3) signs an exact,
   one-payday PermitSingle from the embedded key — all using the shared lib/payroll/permit2 so the
   message is byte-identical to what the keeper later submits. Returns the signature + nonce to store
   on the campaign. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { getWalletCustody } from "@/lib/custody";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import {
    PERMIT2_ADDRESS,
    PERMIT2_TYPES,
    permit2Domain,
    buildPermitSingle,
    payrollPermitWindow,
} from "@/lib/payroll/permit2";

export const maxDuration = 120;

const ERC20_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
];
const PERMIT2_ALLOWANCE_ABI = [
    "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
];

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = await request.json().catch(() => null);
        const totalAmountText = typeof body?.totalAmountUsdc === "string"
            ? body.totalAmountUsdc
            : "";
        const frequencyDays = body?.frequencyDays;
        if (!/^\d+$/.test(totalAmountText) || BigInt(totalAmountText) <= BigInt(0)) {
            return NextResponse.json({ error: "A positive exact payroll total is required." }, { status: 400 });
        }
        let window: ReturnType<typeof payrollPermitWindow>;
        try {
            window = payrollPermitWindow(frequencyDays);
        } catch (windowError: any) {
            return NextResponse.json({ error: windowError.message }, { status: 400 });
        }
        const totalAmount = BigInt(totalAmountText);

        const keeperKey = process.env.PRIVATE_KEY;
        if (!keeperKey) {
            return NextResponse.json({ error: "Payroll keeper is not configured on the server." }, { status: 500 });
        }
        const keeperAddress = new ethers.Wallet(keeperKey).address;

        const merchant = wallet.toLowerCase();
        /* Throws "no server-held key" for external wallets — which can't be merchants anymore. */
        const custody = await getWalletCustody(merchant);
        const { provider } = await getRpcProviderForWrite();
        const chainId = Number((await provider.getNetwork()).chainId);

        /* 1. Approve only this payday's total to Permit2. */
        const usdc = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, ERC20_ABI, provider);
        const currentAllowance: bigint = BigInt(await usdc.allowance(merchant, PERMIT2_ADDRESS));
        if (currentAllowance !== totalAmount) {
            await custody.executeContract({
                contractAddress: USDC_NATIVE_GAS_ADDRESS,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [PERMIT2_ADDRESS, totalAmount],
            });
        }

        /* 2. Read the current Permit2 nonce for (merchant, USDC, keeper). */
        const permit2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ALLOWANCE_ABI, provider);
        const allowanceRes = await permit2.allowance(merchant, USDC_NATIVE_GAS_ADDRESS, keeperAddress);
        const nonce = Number(allowanceRes.nonce ?? allowanceRes[2]);

        /* 3. Sign the bounded PermitSingle (shared with the keeper). Circle SCA
           signatures verify via ERC-1271, which Permit2 supports for contract accounts. */
        const message = buildPermitSingle(
            USDC_NATIVE_GAS_ADDRESS,
            keeperAddress,
            nonce,
            totalAmount,
            window.expiration,
            window.sigDeadline,
        );
        const signature = await custody.signTypedData(permit2Domain(chainId), PERMIT2_TYPES as any, message as any);

        return NextResponse.json({
            success: true,
            signature,
            nonce,
            keeperAddress,
            amountUsdc: totalAmount.toString(),
            permit2Deadline: new Date(Number(window.sigDeadline) * 1000).toISOString(),
            permit2Expiration: new Date(Number(window.expiration) * 1000).toISOString(),
        }, { status: 200 });
    } catch (error: any) {
        console.error("Payroll permit-sign failed:", error);
        return NextResponse.json({ error: error.message || "Failed to authorize payroll" }, { status: 500 });
    }
}
