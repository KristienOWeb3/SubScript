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
    /* Bypassed: Email plan held since there is no domain configured currently */
    const isDomainConfigured = process.env.HAS_CUSTOM_DOMAIN === "true";
    if (!isDomainConfigured) {
        console.log("Exit survey email dispatch held: no domain configured.");
        return;
    }

    const db = supabaseAdmin;
    const client = resend;

    try {
        if (!db) {
            console.error("Supabase admin client is not initialized.");
            return;
        }

        const { data: template, error: templateError } = await db
            .from("merchant_email_templates")
            .select("*")
            .eq("merchant_address", merchantAddress.toLowerCase())
            .maybeSingle();

        if (templateError) {
            console.error("Error fetching exit survey template:", templateError);
            return;
        }

        if (!template || !template.is_active) {
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

        const subject = template.subject_line
            .replace(/\{\{customer_wallet\}\}/g, customerWalletStr)
            .replace(/\{\{subscription_tier\}\}/g, tierStr);

        const body = template.body_content
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
