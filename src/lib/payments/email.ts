/* Automated Churn Recovery email dispatcher */
/* Configured for Next.js API router and Resend client */

import { Resend } from "resend";
import { supabaseAdmin } from "../supabaseAdmin";
import { ethers } from "ethers";
import { STANDARD_CONTRACT_ADDRESS } from "../contracts/constants";

const STANDARD_ABI = [
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)"
];

const resendApiKey = process.env.RESEND_API_KEY || "";
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const senderEmail = process.env.EXIT_SURVEY_SENDER_EMAIL || "onboarding@resend.dev";

export async function triggerExitSurvey(
    merchantAddress: string,
    customerAddressOrSubId: string | number,
    subscriptionTier: string | number
) {
    const db = supabaseAdmin;
    const client = resend;

    try {
        if (!db) {
            console.error("Supabase admin client is not initialized.");
            return;
        }

        let customerAddress = "";
        if (typeof customerAddressOrSubId === "number" || /^\d+$/.test(String(customerAddressOrSubId))) {
            try {
                const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
                const provider = new ethers.JsonRpcProvider(rpcUrl);
                const standardContract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, STANDARD_ABI, provider);
                const subOnChain = await standardContract.subscriptions(customerAddressOrSubId);
                customerAddress = subOnChain[0];
            } catch (contractErr) {
                console.error("Failed to fetch subscriber address on-chain:", contractErr);
                return;
            }
        } else {
            customerAddress = String(customerAddressOrSubId);
        }

        if (!customerAddress) {
            console.warn("Could not determine customer wallet address. Skip exit survey.");
            return;
        }

        // Fetch the merchant name / alias for the DM description
        const merchantAliasResult = await db
            .from("address_aliases")
            .select("alias")
            .eq("address", merchantAddress.toLowerCase())
            .maybeSingle();
        const merchantName = merchantAliasResult?.data?.alias || merchantAddress;

        // Insert CHURN_SURVEY system-DM in subscript_dms
        try {
            const { error: dmInsertErr } = await db.from("subscript_dms").insert({
                sender_address: merchantAddress.toLowerCase(),
                receiver_address: customerAddress.toLowerCase(),
                message_type: "CHURN_SURVEY",
                status: "PENDING",
                title: "We are sorry to see you go",
                description: `Exit survey for tier ${subscriptionTier}: We would love to know why you cancelled your subscription. Please select one of the options below to help ${merchantName} improve:`,
            });
            if (dmInsertErr) {
                console.error("Database error inserting exit survey DM:", dmInsertErr);
            } else {
                console.log("Exit survey DM created successfully.");
            }
        } catch (dmInsertErr) {
            console.error("Failed to insert exit survey DM:", dmInsertErr);
        }

        /* Bypassed: Email plan held since there is no domain configured currently */
        const isDomainConfigured = process.env.HAS_CUSTOM_DOMAIN === "true";
        if (!isDomainConfigured) {
            console.log("Exit survey email dispatch held: no domain configured.");
            return;
        }

        const { data: template, error: templateError } = await db
            .from("merchant_email_templates")
            .select("*")
            .eq("merchant_address", merchantAddress.toLowerCase())
            .maybeSingle();

        if (templateError) {
            console.error("Error fetching exit survey template, falling back to default:", templateError);
        }

        const adminAddress = (process.env.ADMIN_WALLET_ADDRESS || "").toLowerCase();
        let subjectTemplate = "We are sorry to see you go";
        let bodyTemplate = "Hello,\n\nWe noticed that your subscription (Tier: {{subscription_tier}}) was cancelled for wallet {{customer_wallet}}. We would appreciate it if you could share your feedback with us.\n\nBest regards,\nSubScript Team";

        if (template && template.is_active && merchantAddress.toLowerCase() !== adminAddress) {
            subjectTemplate = template.subject_line;
            bodyTemplate = template.body_content;
        }

        let email = "";
        const customerResult = await db
            .from("customers")
            .select("email")
            .eq("wallet_address", customerAddress.toLowerCase())
            .maybeSingle();
        
        const customerData = customerResult?.data;

        if (customerData?.email) {
            email = customerData.email;
        } else {
            const walletResult = await db
                .from("user_embedded_wallets")
                .select("email")
                .eq("wallet_address", customerAddress.toLowerCase())
                .maybeSingle();
            
            const walletData = walletResult?.data;

            if (walletData?.email) {
                email = walletData.email;
            }
        }

        if (!email) {
            console.warn("No email found for customer. Skip exit survey.");
            return;
        }

        const tierStr = String(subscriptionTier);
        const customerWalletStr = customerAddress;

        const subject = subjectTemplate
            .replace(/\{\{customer_wallet\}\}/g, customerWalletStr)
            .replace(/\{\{subscription_tier\}\}/g, tierStr);

        const body = bodyTemplate
            .replace(/\{\{customer_wallet\}\}/g, customerWalletStr)
            .replace(/\{\{subscription_tier\}\}/g, tierStr);

        if (!client) {
            console.error("Resend client is not initialized.");
            return;
        }

        const response = await client.emails.send({
            from: senderEmail,
            to: email,
            subject: subject,
            text: body,
        });

        if (response.error) {
            console.error("Resend email dispatch error:", response.error);
        } else {
            console.log("Exit survey email sent successfully.");
        }

    } catch (err: any) {
        console.error("Failed to trigger exit survey:", err);
    }
}
