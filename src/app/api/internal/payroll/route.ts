import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ethers } from "ethers";
import { CONFIDENTIAL_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { CONFIDENTIAL_CONTRACT_ABI } from "@/lib/contracts/abis";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import crypto from "crypto";

/* USDC address and Permit2 address constants */
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/* ABI for ERC20 USDC token */
const ERC20_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)"
];

/* ABI for Permit2 allowance contract */
const PERMIT2_ABI = [
    "function allowance(address user, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
    "function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes calldata signature) external",
    "function transferFrom(address from, address to, uint160 amount, address token) external"
];

export async function POST(request: Request) {
    const requestId = crypto.randomUUID();
    
    try {
        /* 1. Authenticate with keeper secret key */
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json(
                { error: "Configuration Error: Keeper secret key configuration missing" },
                { status: 500 }
            );
        }

        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        /* 2. Load admin private key and verify */
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return NextResponse.json(
                { error: "Configuration Error: Keeper private key missing on server" },
                { status: 500 }
            );
        }

        /* 3. Query all ACTIVE campaigns whose paydays are due (nextPayday <= NOW) */
        const now = new Date();
        const campaigns = await prisma.payrollCampaign.findMany({
            where: {
                status: "ACTIVE",
                nextPayday: {
                    lte: now
                }
            },
            include: {
                recipients: true
            }
        });

        const executionResults: any[] = [];

        /* 4. Process each campaign */
        for (const campaign of campaigns) {
            try {
                const orgAddress = campaign.organizationAddress.toLowerCase();

                /* Verify organization's premium status in database */
                const merchant = await prisma.merchant.findUnique({
                    where: { walletAddress: orgAddress }
                });

                const isPremium = merchant && (
                    merchant.tier === "1" || 
                    merchant.tier === "PREMIUM"
                );

                if (!isPremium) {
                    /* Organization is not premium, skip execution and pause the campaign */
                    await prisma.payrollCampaign.update({
                        where: { id: campaign.id },
                        data: { status: "PAUSED" }
                    });

                    /* Write audit event */
                    await prisma.auditEvent.create({
                        data: {
                            actor: "KEEPER_CRON",
                            action: "PAYROLL_CAMPAIGN_PAUSED_NON_PREMIUM",
                            resourceType: "PAYROLL_CAMPAIGN",
                            resourceId: campaign.id,
                            metadata: {
                                error: "Organization does not hold premium tier",
                                organization: orgAddress
                            }
                        }
                    });

                    executionResults.push({
                        campaignId: campaign.id,
                        status: "FAILED",
                        reason: "Organization does not hold premium tier. Campaign paused."
                    });
                    continue;
                }

                if (campaign.recipients.length === 0) {
                    executionResults.push({
                        campaignId: campaign.id,
                        status: "SKIPPED",
                        reason: "No recipients registered in this campaign."
                    });
                    continue;
                }

                /* Calculate total payroll amount in micro-USDC (6 decimals) */
                let totalPayrollAmount = BigInt(0);
                const recipientAddresses: string[] = [];
                const recipientAmounts: bigint[] = [];

                for (const recipient of campaign.recipients) {
                    totalPayrollAmount += recipient.salaryAmountUsdc;
                    recipientAddresses.push(recipient.employeeWallet);
                    recipientAmounts.push(recipient.salaryAmountUsdc);
                }

                const { provider, rpcEndpoint } = await getRpcProviderForWrite();
                const wallet = new ethers.Wallet(adminPrivateKey, provider);
                const keeperAddress = wallet.address;

                const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet);
                const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
                const confidentialContract = new ethers.Contract(
                    CONFIDENTIAL_CONTRACT_ADDRESS,
                    CONFIDENTIAL_CONTRACT_ABI,
                    wallet
                );

                /* Step A: Check existing Permit2 allowance for the Keeper from the organization */
                const allowanceResult = await permit2Contract.allowance(
                    orgAddress,
                    USDC_ADDRESS,
                    keeperAddress
                );

                const existingAllowanceAmount = BigInt(allowanceResult.amount.toString());
                const existingAllowanceExpiration = Number(allowanceResult.expiration);
                const currentTimestamp = Math.floor(Date.now() / 1000);

                if (
                    existingAllowanceAmount < totalPayrollAmount ||
                    existingAllowanceExpiration < currentTimestamp
                ) {
                    /* Allowance is insufficient or expired. Submit the signed Permit2 permit if available. */
                    if (!campaign.permit2Signature) {
                        throw new Error("Insufficient Permit2 allowance and no permit2Signature is saved.");
                    }

                    const expirationTime = campaign.permit2Expiration
                        ? Math.floor(new Date(campaign.permit2Expiration).getTime() / 1000)
                        : currentTimestamp + 86400 * 30;

                    const sigDeadlineTime = campaign.permit2Deadline
                        ? Math.floor(new Date(campaign.permit2Deadline).getTime() / 1000)
                        : currentTimestamp + 86400;

                    const permitSingleStruct = {
                        details: {
                            token: USDC_ADDRESS,
                            amount: totalPayrollAmount * BigInt(100), /* Approve large amount for recurring usage */
                            expiration: expirationTime,
                            nonce: campaign.permit2Nonce || 0
                        },
                        spender: keeperAddress,
                        sigDeadline: sigDeadlineTime
                    };

                    const permitTx = await permit2Contract.permit(
                        orgAddress,
                        permitSingleStruct,
                        campaign.permit2Signature
                    );
                    await permitTx.wait();
                }

                /* Step B: Pull USDC tokens from organization into Keeper wallet */
                const transferTx = await permit2Contract.transferFrom(
                    orgAddress,
                    keeperAddress,
                    totalPayrollAmount,
                    USDC_ADDRESS
                );
                await transferTx.wait();

                /* Step C: Check and approve USDC allowance for Confidential contract if needed */
                const contractAllowance = await usdcContract.allowance(
                    keeperAddress,
                    CONFIDENTIAL_CONTRACT_ADDRESS
                );

                if (BigInt(contractAllowance.toString()) < totalPayrollAmount) {
                    const approveTx = await usdcContract.approve(
                        CONFIDENTIAL_CONTRACT_ADDRESS,
                        ethers.MaxUint256
                    );
                    await approveTx.wait();
                }

                const batchTx = await confidentialContract.executeBatchPayout(
                    recipientAddresses,
                    recipientAmounts,
                    campaign.isShielded,
                    ethers.ZeroHash
                );

                const receipt = await batchTx.wait();
                if (receipt.status !== 1) {
                    throw new Error("On-chain batch payout transaction execution reverted.");
                }
                console.log(`[payroll-cron] submitted campaign ${campaign.id} through ${rpcEndpoint}: ${batchTx.hash}`);

                const txHash = batchTx.hash as string;

                /* Step E: Calculate next payday based on frequencyDays */
                const nextPaydayDate = new Date(Date.now() + campaign.frequencyDays * 24 * 60 * 60 * 1000);

                /* Update campaign in database */
                await prisma.payrollCampaign.update({
                    where: { id: campaign.id },
                    data: {
                        nextPayday: nextPaydayDate,
                        permit2Nonce: campaign.permit2Nonce !== null ? campaign.permit2Nonce + 1 : 1
                    }
                });

                /* Write successful audit event */
                await prisma.auditEvent.create({
                    data: {
                        actor: "KEEPER_CRON",
                        action: "PAYROLL_CAMPAIGN_EXECUTED",
                        resourceType: "PAYROLL_CAMPAIGN",
                        resourceId: campaign.id,
                        metadata: {
                            txHash,
                            totalAmountUsdc: totalPayrollAmount.toString(),
                            recipientCount: recipientAddresses.length
                        }
                    }
                });

                executionResults.push({
                    campaignId: campaign.id,
                    status: "SUCCESS",
                    txHash,
                    totalAmountUsdc: totalPayrollAmount.toString()
                });

            } catch (campaignErr: any) {
                console.error(`[Payroll Cron] Failed to execute campaign ${campaign.id}:`, campaignErr);

                /* Pause the campaign on error to prevent infinite failing loops */
                await prisma.payrollCampaign.update({
                    where: { id: campaign.id },
                    data: { status: "PAUSED" }
                });

                await prisma.auditEvent.create({
                    data: {
                        actor: "KEEPER_CRON",
                        action: "PAYROLL_CAMPAIGN_FAILED",
                        resourceType: "PAYROLL_CAMPAIGN",
                        resourceId: campaign.id,
                        metadata: {
                            error: campaignErr.message || "Unknown execution error"
                        }
                    }
                });

                executionResults.push({
                    campaignId: campaign.id,
                    status: "FAILED",
                    reason: campaignErr.message || "Unknown execution error"
                });
            }
        }

        return NextResponse.json({
            success: true,
            processed: executionResults.length,
            results: executionResults
        }, { status: 200 });

    } catch (err: any) {
        console.error("Cron payroll engine error:", err);
        return NextResponse.json(
            { error: err.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    return POST(request);
}
