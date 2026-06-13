/* API route for managing merchant payroll campaigns and recipients */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* Ethereum address validation: 0x followed by 40 hex characters */
const ETH_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/* UUID v4 validation */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Valid actions for the PUT endpoint */
const VALID_ACTIONS = ["PAUSE", "RESUME", "UPDATE_PERMIT"] as const;
type CampaignAction = typeof VALID_ACTIONS[number];

/* Helper function to check if the merchant is PREMIUM */
async function verifyPremiumTier(normalizedUser: string): Promise<boolean> {
    if (!supabaseAdmin) {
        return false;
    }
    const { data, error } = await supabaseAdmin
        .from("merchants")
        .select("tier")
        .eq("wallet_address", normalizedUser)
        .maybeSingle();
    if (error || !data) {
        return false;
    }
    return data.tier === "PREMIUM";
}

/**
 * GET - List all payroll campaigns for the authenticated merchant.
 * Each campaign includes the recipient count and total payroll amount.
 */
export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        const isPremium = await verifyPremiumTier(normalizedUser);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: Institutional Payroll requires a PREMIUM tier subscription." }, { status: 403 });
        }

        /* Fetch all campaigns belonging to this merchant */
        const { data: campaigns, error: campaignsError } = await supabaseAdmin
            .from("payroll_campaigns")
            .select("*")
            .eq("organization_address", normalizedUser)
            .order("next_payday", { ascending: true });

        if (campaignsError) {
            console.error("Failed to fetch payroll campaigns:", campaignsError);
            return NextResponse.json({ error: "Database error fetching campaigns" }, { status: 500 });
        }

        if (!campaigns || campaigns.length === 0) {
            return NextResponse.json({ campaigns: [] }, { status: 200 });
        }

        /* Gather all campaign IDs to fetch recipients in a single query */
        const campaignIds = campaigns.map((c: any) => c.id);

        const { data: recipients, error: recipientsError } = await supabaseAdmin
            .from("payroll_recipients")
            .select("id, campaign_id, employee_wallet, salary_amount_usdc")
            .in("campaign_id", campaignIds);

        if (recipientsError) {
            console.error("Failed to fetch payroll recipients:", recipientsError);
            return NextResponse.json({ error: "Database error fetching recipients" }, { status: 500 });
        }

        /* Collect unique employee wallets to fetch aliases */
        const employeeWallets = new Set<string>();
        for (const r of (recipients || [])) {
            if (r.employee_wallet) {
                employeeWallets.add(r.employee_wallet.toLowerCase());
            }
        }

        const aliasMap: Record<string, { alias: string; is_anonymous: boolean }> = {};
        if (employeeWallets.size > 0) {
            const { data: aliases } = await supabaseAdmin
                .from("address_aliases")
                .select("address, alias, is_anonymous")
                .in("address", Array.from(employeeWallets));

            if (aliases) {
                for (const row of aliases) {
                    aliasMap[row.address.toLowerCase()] = {
                        alias: row.alias,
                        is_anonymous: row.is_anonymous
                    };
                }
            }
        }

        /* Build maps: campaign_id -> recipients list and campaign_id -> aggregate stats */
        const campaignRecipients: Record<string, any[]> = {};
        const recipientStats: Record<string, { count: number; totalAmountUsdc: string }> = {};

        for (const r of (recipients || [])) {
            const campaignId = r.campaign_id;
            if (!recipientStats[campaignId]) {
                recipientStats[campaignId] = { count: 0, totalAmountUsdc: "0" };
            }
            if (!campaignRecipients[campaignId]) {
                campaignRecipients[campaignId] = [];
            }

            recipientStats[campaignId].count += 1;
            const currentTotal = BigInt(recipientStats[campaignId].totalAmountUsdc);
            const salary = BigInt(r.salary_amount_usdc);
            recipientStats[campaignId].totalAmountUsdc = (currentTotal + salary).toString();

            const match = aliasMap[r.employee_wallet.toLowerCase()];
            campaignRecipients[campaignId].push({
                id: r.id,
                campaignId: r.campaign_id,
                employeeWallet: r.employee_wallet,
                salaryAmountUsdc: r.salary_amount_usdc,
                employeeAlias: match ? (match.is_anonymous ? "Anonymous" : match.alias) : null,
                isEmployeeAnonymous: match ? match.is_anonymous : false
            });
        }

        /* Map campaigns to camelCase response with aggregated stats and detailed recipients */
        const result = campaigns.map((c: any) => {
            const stats = recipientStats[c.id] || { count: 0, totalAmountUsdc: "0" };
            return {
                id: c.id,
                organizationAddress: c.organization_address,
                title: c.title,
                frequencyDays: c.frequency_days,
                nextPayday: c.next_payday,
                isShielded: c.is_shielded,
                status: c.status,
                permit2Signature: c.permit2_signature,
                permit2Nonce: c.permit2_nonce,
                permit2Deadline: c.permit2_deadline,
                permit2Expiration: c.permit2_expiration,
                recipientCount: stats.count,
                totalPayrollUsdc: stats.totalAmountUsdc,
                recipients: campaignRecipients[c.id] || []
            };
        });

        return NextResponse.json({ campaigns: result }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to list payroll campaigns:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

/**
 * POST - Create a new payroll campaign with recipients.
 * Sets next_payday to current time + frequencyDays.
 */
export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        const isPremium = await verifyPremiumTier(normalizedUser);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: Institutional Payroll requires a PREMIUM tier subscription." }, { status: 403 });
        }

        const body = await request.json();
        const {
            title,
            frequencyDays,
            isShielded,
            permit2Signature,
            permit2Nonce,
            permit2Deadline,
            permit2Expiration,
            recipients,
        } = body;

        /* --- Input validation --- */

        if (!title || typeof title !== "string" || title.trim().length === 0) {
            return NextResponse.json({ error: "Missing or invalid field: title" }, { status: 400 });
        }

        if (title.trim().length > 200) {
            return NextResponse.json({ error: "Title must be 200 characters or fewer" }, { status: 400 });
        }

        if (frequencyDays === undefined || typeof frequencyDays !== "number" || !Number.isInteger(frequencyDays) || frequencyDays < 1) {
            return NextResponse.json({ error: "Missing or invalid field: frequencyDays (must be a positive integer)" }, { status: 400 });
        }

        if (typeof isShielded !== "boolean") {
            return NextResponse.json({ error: "Missing or invalid field: isShielded (must be a boolean)" }, { status: 400 });
        }

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return NextResponse.json({ error: "At least one recipient is required" }, { status: 400 });
        }

        if (recipients.length > 500) {
            return NextResponse.json({ error: "Maximum 500 recipients per campaign" }, { status: 400 });
        }

        /* Validate each recipient */
        for (let i = 0; i < recipients.length; i++) {
            const r = recipients[i];

            if (!r || typeof r !== "object") {
                return NextResponse.json({ error: `Invalid recipient at index ${i}` }, { status: 400 });
            }

            if (!r.employeeWallet || typeof r.employeeWallet !== "string" || !ETH_ADDRESS_REGEX.test(r.employeeWallet)) {
                return NextResponse.json({
                    error: `Invalid employeeWallet at index ${i}: must be a valid Ethereum address (0x + 40 hex chars)`,
                }, { status: 400 });
            }

            if (r.salaryAmountUsdc === undefined || r.salaryAmountUsdc === null) {
                return NextResponse.json({ error: `Missing salaryAmountUsdc at index ${i}` }, { status: 400 });
            }

            /* Accept string or number, but validate it represents a positive integer (bigint-safe) */
            let salaryStr: string;
            try {
                salaryStr = String(r.salaryAmountUsdc);
                const salaryBig = BigInt(salaryStr);
                if (salaryBig <= BigInt(0)) {
                    return NextResponse.json({ error: `salaryAmountUsdc at index ${i} must be a positive amount` }, { status: 400 });
                }
            } catch {
                return NextResponse.json({ error: `Invalid salaryAmountUsdc at index ${i}: must be a valid positive integer` }, { status: 400 });
            }
        }

        /* Validate optional Permit2 fields: if signature is provided, all permit fields are required */
        if (permit2Signature !== undefined && permit2Signature !== null) {
            if (typeof permit2Signature !== "string" || permit2Signature.trim().length === 0) {
                return NextResponse.json({ error: "Invalid permit2Signature" }, { status: 400 });
            }
            if (permit2Nonce === undefined || permit2Nonce === null || typeof permit2Nonce !== "number" || !Number.isInteger(permit2Nonce) || permit2Nonce < 0) {
                return NextResponse.json({ error: "Invalid permit2Nonce: must be a non-negative integer when permit2Signature is provided" }, { status: 400 });
            }
            if (!permit2Deadline || typeof permit2Deadline !== "string") {
                return NextResponse.json({ error: "Invalid permit2Deadline: must be an ISO timestamp when permit2Signature is provided" }, { status: 400 });
            }
            if (!permit2Expiration || typeof permit2Expiration !== "string") {
                return NextResponse.json({ error: "Invalid permit2Expiration: must be an ISO timestamp when permit2Signature is provided" }, { status: 400 });
            }

            /* Verify the timestamp strings are valid dates */
            if (isNaN(Date.parse(permit2Deadline))) {
                return NextResponse.json({ error: "permit2Deadline is not a valid ISO date" }, { status: 400 });
            }
            if (isNaN(Date.parse(permit2Expiration))) {
                return NextResponse.json({ error: "permit2Expiration is not a valid ISO date" }, { status: 400 });
            }
        }

        /* Calculate next_payday: current time + frequencyDays */
        const now = new Date();
        const nextPayday = new Date(now.getTime() + frequencyDays * 24 * 60 * 60 * 1000);

        /* Insert the campaign */
        const campaignRow: any = {
            organization_address: normalizedUser,
            title: title.trim(),
            frequency_days: frequencyDays,
            next_payday: nextPayday.toISOString(),
            is_shielded: isShielded,
            status: "ACTIVE",
            permit2_signature: permit2Signature || null,
            permit2_nonce: permit2Nonce !== undefined && permit2Nonce !== null ? permit2Nonce : null,
            permit2_deadline: permit2Deadline || null,
            permit2_expiration: permit2Expiration || null,
        };

        const { data: campaign, error: campaignError } = await supabaseAdmin
            .from("payroll_campaigns")
            .insert(campaignRow)
            .select("*")
            .single();

        if (campaignError) {
            console.error("Failed to insert payroll campaign:", campaignError);
            return NextResponse.json({ error: "Database error creating campaign" }, { status: 500 });
        }

        /* Insert all recipients for this campaign */
        const recipientRows = recipients.map((r: any) => ({
            campaign_id: campaign.id,
            employee_wallet: r.employeeWallet.toLowerCase(),
            salary_amount_usdc: String(r.salaryAmountUsdc),
        }));

        const { data: insertedRecipients, error: recipientsError } = await supabaseAdmin
            .from("payroll_recipients")
            .insert(recipientRows)
            .select("*");

        if (recipientsError) {
            console.error("Failed to insert payroll recipients:", recipientsError);
            /* Attempt to clean up the orphaned campaign */
            await supabaseAdmin
                .from("payroll_campaigns")
                .delete()
                .eq("id", campaign.id);
            return NextResponse.json({ error: "Database error creating recipients" }, { status: 500 });
        }

        /* Map response to camelCase */
        const recipientResult = (insertedRecipients || []).map((r: any) => ({
            id: r.id,
            campaignId: r.campaign_id,
            employeeWallet: r.employee_wallet,
            salaryAmountUsdc: r.salary_amount_usdc,
        }));

        return NextResponse.json({
            campaign: {
                id: campaign.id,
                organizationAddress: campaign.organization_address,
                title: campaign.title,
                frequencyDays: campaign.frequency_days,
                nextPayday: campaign.next_payday,
                isShielded: campaign.is_shielded,
                status: campaign.status,
                permit2Signature: campaign.permit2_signature,
                permit2Nonce: campaign.permit2_nonce,
                permit2Deadline: campaign.permit2_deadline,
                permit2Expiration: campaign.permit2_expiration,
            },
            recipients: recipientResult,
        }, { status: 201 });

    } catch (err: any) {
        console.error("Failed to create payroll campaign:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

/**
 * PUT - Update campaign status (PAUSE/RESUME) or update Permit2 signature fields.
 * The merchant can only modify their own campaigns.
 */
export async function PUT(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        const isPremium = await verifyPremiumTier(normalizedUser);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: Institutional Payroll requires a PREMIUM tier subscription." }, { status: 403 });
        }

        const body = await request.json();
        const { campaignId, action, permit2Signature, permit2Nonce, permit2Deadline, permit2Expiration } = body;

        /* Validate campaignId */
        if (!campaignId || typeof campaignId !== "string" || !UUID_REGEX.test(campaignId)) {
            return NextResponse.json({ error: "Missing or invalid field: campaignId (must be a valid UUID)" }, { status: 400 });
        }

        /* Validate action */
        if (!action || !VALID_ACTIONS.includes(action as CampaignAction)) {
            return NextResponse.json({
                error: `Invalid action: must be one of ${VALID_ACTIONS.join(", ")}`,
            }, { status: 400 });
        }

        /* Verify campaign exists and belongs to this merchant */
        const { data: existing, error: lookupError } = await supabaseAdmin
            .from("payroll_campaigns")
            .select("id, organization_address, status")
            .eq("id", campaignId)
            .maybeSingle();

        if (lookupError) {
            console.error("Database lookup failed:", lookupError);
            return NextResponse.json({ error: "Database error looking up campaign" }, { status: 500 });
        }

        if (!existing) {
            return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }

        if (existing.organization_address !== normalizedUser) {
            return NextResponse.json({ error: "Access denied: you do not own this campaign" }, { status: 403 });
        }

        /* Build the update object based on the action */
        const updateObj: any = {};

        if (action === "PAUSE") {
            if (existing.status === "PAUSED") {
                return NextResponse.json({ error: "Campaign is already paused" }, { status: 400 });
            }
            updateObj.status = "PAUSED";
        } else if (action === "RESUME") {
            if (existing.status === "ACTIVE") {
                return NextResponse.json({ error: "Campaign is already active" }, { status: 400 });
            }
            updateObj.status = "ACTIVE";
        } else if (action === "UPDATE_PERMIT") {
            /* All permit2 fields are required for this action */
            if (!permit2Signature || typeof permit2Signature !== "string" || permit2Signature.trim().length === 0) {
                return NextResponse.json({ error: "permit2Signature is required for UPDATE_PERMIT action" }, { status: 400 });
            }
            if (permit2Nonce === undefined || permit2Nonce === null || typeof permit2Nonce !== "number" || !Number.isInteger(permit2Nonce) || permit2Nonce < 0) {
                return NextResponse.json({ error: "permit2Nonce must be a non-negative integer for UPDATE_PERMIT action" }, { status: 400 });
            }
            if (!permit2Deadline || typeof permit2Deadline !== "string" || isNaN(Date.parse(permit2Deadline))) {
                return NextResponse.json({ error: "permit2Deadline must be a valid ISO timestamp for UPDATE_PERMIT action" }, { status: 400 });
            }
            if (!permit2Expiration || typeof permit2Expiration !== "string" || isNaN(Date.parse(permit2Expiration))) {
                return NextResponse.json({ error: "permit2Expiration must be a valid ISO timestamp for UPDATE_PERMIT action" }, { status: 400 });
            }

            updateObj.permit2_signature = permit2Signature;
            updateObj.permit2_nonce = permit2Nonce;
            updateObj.permit2_deadline = permit2Deadline;
            updateObj.permit2_expiration = permit2Expiration;
        }

        /* Apply the update */
        const { data: updated, error: updateError } = await supabaseAdmin
            .from("payroll_campaigns")
            .update(updateObj)
            .eq("id", campaignId)
            .select("*")
            .single();

        if (updateError) {
            console.error("Failed to update payroll campaign:", updateError);
            return NextResponse.json({ error: "Database error updating campaign" }, { status: 500 });
        }

        return NextResponse.json({
            campaign: {
                id: updated.id,
                organizationAddress: updated.organization_address,
                title: updated.title,
                frequencyDays: updated.frequency_days,
                nextPayday: updated.next_payday,
                isShielded: updated.is_shielded,
                status: updated.status,
                permit2Signature: updated.permit2_signature,
                permit2Nonce: updated.permit2_nonce,
                permit2Deadline: updated.permit2_deadline,
                permit2Expiration: updated.permit2_expiration,
            },
        }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to update payroll campaign:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

/**
 * DELETE - Delete a payroll campaign and its recipients by campaign ID.
 * Query param: ?id=<uuid>
 */
export async function DELETE(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        const isPremium = await verifyPremiumTier(normalizedUser);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: Institutional Payroll requires a PREMIUM tier subscription." }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id || !UUID_REGEX.test(id)) {
            return NextResponse.json({ error: "Missing or invalid query parameter: id (must be a valid UUID)" }, { status: 400 });
        }

        /* Verify campaign exists and belongs to this merchant */
        const { data: existing, error: lookupError } = await supabaseAdmin
            .from("payroll_campaigns")
            .select("id, organization_address")
            .eq("id", id)
            .maybeSingle();

        if (lookupError) {
            console.error("Database lookup failed:", lookupError);
            return NextResponse.json({ error: "Database error looking up campaign" }, { status: 500 });
        }

        if (!existing) {
            return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }

        if (existing.organization_address !== normalizedUser) {
            return NextResponse.json({ error: "Access denied: you do not own this campaign" }, { status: 403 });
        }

        /* Delete recipients first (child rows) */
        const { error: deleteRecipientsError } = await supabaseAdmin
            .from("payroll_recipients")
            .delete()
            .eq("campaign_id", id);

        if (deleteRecipientsError) {
            console.error("Failed to delete payroll recipients:", deleteRecipientsError);
            return NextResponse.json({ error: "Database error deleting recipients" }, { status: 500 });
        }

        /* Delete the campaign itself */
        const { error: deleteCampaignError } = await supabaseAdmin
            .from("payroll_campaigns")
            .delete()
            .eq("id", id);

        if (deleteCampaignError) {
            console.error("Failed to delete payroll campaign:", deleteCampaignError);
            return NextResponse.json({ error: "Database error deleting campaign" }, { status: 500 });
        }

        return NextResponse.json({ success: true, deletedCampaignId: id }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to delete payroll campaign:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
