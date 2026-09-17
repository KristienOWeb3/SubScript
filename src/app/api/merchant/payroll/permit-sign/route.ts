/* Server-side Permit2 authorization for an EMBEDDED-wallet merchant (the only kind now). Since the
   merchant has no browser wallet to sign with, the server: (1) approves USDC -> Permit2 once on its
   behalf (gas sponsored), (2) reads the current on-chain Permit2 nonce, and (3) signs an exact,
   one-payday PermitSingle from the embedded key — all using the shared lib/payroll/permit2 so the
   message is byte-identical to what the keeper later submits. Returns the signature + nonce to store
   on the campaign. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getVerifiedSessionToken } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { haltGuard } from "@/lib/accountHalt";
import { getWalletCustody } from "@/lib/custody";
import { authorizeFinancialStepUp } from "@/lib/auth/stepUp";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import {
    PERMIT2_ADDRESS,
    PERMIT2_MAX_AMOUNT,
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
        const session = await getVerifiedSessionToken(request.headers);
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const wallet = session.wallet.toLowerCase();
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        /* This is where the Permit2 authorization for a payroll run is minted, so it is the single
           largest new authorization an organization grants: one signature the keeper then draws a
           whole payroll against. A hold refuses it. */
        const held = await haltGuard(wallet);
        if (held) return held;

        const body = await request.json().catch(() => null);
        const recipients = body?.recipients;
        const frequencyDays = body?.frequencyDays;
        if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 500) {
            return NextResponse.json({ error: "Between 1 and 500 canonical payroll recipients are required." }, { status: 400 });
        }

        /* The Permit2 amount is derived from the exact same canonical recipient items the campaign
           endpoint stores. A client-supplied aggregate is only a consistency assertion: it never
           decides how much authority the server signs. */
        let totalAmount = BigInt(0);
        for (let index = 0; index < recipients.length; index += 1) {
            const employeeWallet = recipients[index]?.employeeWallet;
            if (typeof employeeWallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(employeeWallet)) {
                return NextResponse.json({ error: `Invalid employeeWallet at index ${index}.` }, { status: 400 });
            }
            const salary = recipients[index]?.salaryAmountUsdc;
            if (
                (typeof salary !== "string" && typeof salary !== "number")
                || (typeof salary === "number" && !Number.isSafeInteger(salary))
                || !/^\d+$/.test(String(salary))
            ) {
                return NextResponse.json({ error: `Invalid salaryAmountUsdc at index ${index}.` }, { status: 400 });
            }
            const amount = BigInt(String(salary));
            if (amount <= BigInt(0)) {
                return NextResponse.json({ error: `salaryAmountUsdc at index ${index} must be positive.` }, { status: 400 });
            }
            totalAmount += amount;
        }
        if (typeof body?.totalAmountUsdc === "string" && body.totalAmountUsdc !== totalAmount.toString()) {
            return NextResponse.json({ error: "Payroll total does not match the canonical recipient items." }, { status: 400 });
        }
        /* Reject amounts exceeding the Permit2 uint160 ceiling up front. buildPermitSingle rejects
           them later, but only after this route may already have written an ERC20 approval. */
        if (totalAmount > PERMIT2_MAX_AMOUNT) {
            return NextResponse.json({ error: "Payroll total exceeds the maximum authorizable amount." }, { status: 400 });
        }
        let window: ReturnType<typeof payrollPermitWindow>;
        try {
            window = payrollPermitWindow(frequencyDays);
        } catch (windowError: any) {
            return NextResponse.json({ error: windowError.message }, { status: 400 });
        }

        const stepUp = await authorizeFinancialStepUp({
            headers: request.headers,
            wallet,
            session,
            binding: { action: "payrollPermit", amount: totalAmount.toString() },
        });
        if (!stepUp.ok) {
            return NextResponse.json({ error: stepUp.error }, { status: stepUp.status });
        }

        const keeperKey = process.env.PRIVATE_KEY;
        if (!keeperKey) {
            return NextResponse.json({ error: "Payroll keeper is not configured on the server." }, { status: 500 });
        }
        const keeperAddress = new ethers.Wallet(keeperKey).address;

        const merchant = wallet;
        /* Throws "no server-held key" for external wallets — which can't be merchants anymore. */
        const custody = await getWalletCustody(merchant);
        if (custody.address.toLowerCase() !== merchant) {
            return NextResponse.json({ error: "Merchant custody does not match the authenticated session." }, { status: 403 });
        }
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
