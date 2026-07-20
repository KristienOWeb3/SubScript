import { ethers } from "ethers";
import { deterministicIdempotencyKey, getWalletCustody } from "@/lib/custody";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { PERMIT2_ADDRESS } from "@/lib/payroll/permit2";
import { prisma } from "@/lib/prisma";

const ERC20_APPROVE_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
] as const;

/**
 * Reduce the token-level authority that backs Permit2 payroll allowances.
 * Instead of zeroing the approval (which would kill ALL campaigns), compute
 * the aggregate amount still required by all OTHER active campaigns and set
 * the approval to that amount.
 */
export async function revokePayrollAuthority(walletAddress: string, campaignId: string): Promise<string> {
    const normalizedWallet = ethers.getAddress(walletAddress).toLowerCase();

    // Calculate the aggregate amount needed by all OTHER active campaigns
    const otherCampaigns = await prisma.payrollCampaign.findMany({
        where: {
            organizationAddress: normalizedWallet,
            status: "ACTIVE",
            id: { not: campaignId },
        },
        include: { recipients: true },
    });

    const remainingTotal = otherCampaigns.reduce((sum: bigint, c: typeof otherCampaigns[number]) => {
        const campaignTotal = c.recipients.reduce((s: bigint, r: typeof c.recipients[number]) => s + r.salaryAmountUsdc, BigInt(0));
        return sum + campaignTotal;
    }, BigInt(0));

    const custody = await getWalletCustody(normalizedWallet);
    const execution = await custody.executeContract({
        contractAddress: USDC_NATIVE_GAS_ADDRESS,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [PERMIT2_ADDRESS, remainingTotal],
        idempotencyKey: deterministicIdempotencyKey(`payroll-revoke:${campaignId}:${normalizedWallet}`),
    });
    return execution.txHash;
}
