import { ethers } from "ethers";
import { deterministicIdempotencyKey, getWalletCustody } from "@/lib/custody";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { PERMIT2_ADDRESS } from "@/lib/payroll/permit2";

const ERC20_APPROVE_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
] as const;

/**
 * Remove the token-level authority that backs every Permit2 payroll allowance.
 * This fail-closed revocation makes a paused/deleted campaign unable to move
 * funds even if an old PermitSingle signature is later disclosed.
 */
export async function revokePayrollAuthority(walletAddress: string, campaignId: string): Promise<string> {
    const normalizedWallet = ethers.getAddress(walletAddress).toLowerCase();
    const custody = await getWalletCustody(normalizedWallet);
    const execution = await custody.executeContract({
        contractAddress: USDC_NATIVE_GAS_ADDRESS,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [PERMIT2_ADDRESS, BigInt(0)],
        idempotencyKey: deterministicIdempotencyKey(`payroll-revoke:${campaignId}:${normalizedWallet}`),
    });
    return execution.txHash;
}
