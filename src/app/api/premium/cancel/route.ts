import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";
import { SUBSCRIPT_ROUTER_ABI } from "@/lib/contracts/abis";

export async function POST(request: Request) {
    try {
        /* 1. Authenticate the merchant session */
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        /* 2. Connect to Supabase */
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* 3. Query active premium subscription and merchant tier from database */
        const { data: merchantData, error: merchantError } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", normalizedUser)
            .maybeSingle();

        if (merchantError || !merchantData || merchantData.tier < 1) {
            return NextResponse.json({ error: "Merchant does not have an active premium tier." }, { status: 400 });
        }

        const { data: subData, error: subError } = await supabase
            .from("subscriptions")
            .select("subscription_id")
            .eq("merchant_address", normalizedUser)
            .eq("tier", 1)
            .eq("status", "ACTIVE")
            .maybeSingle();

        if (subError || !subData) {
            return NextResponse.json({ error: "No active premium subscription found for this merchant." }, { status: 404 });
        }

        const subId = Number(subData.subscription_id);

        /* 4. Execute the On-Chain Revocation */
        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

        const routerContract = new ethers.Contract(
            SUBSCRIPT_ROUTER_ADDRESS,
            SUBSCRIPT_ROUTER_ABI,
            adminWallet
        );

        const currentContractTier = Number(await routerContract.merchantTiers(normalizedUser));
        let downgradeTxHash = null;

        if (currentContractTier > 0) {
            const tx = await routerContract.setMerchantTier(normalizedUser, 0);
            const receipt = await tx.wait();
            if (receipt.status !== 1) {
                return NextResponse.json({ error: "Failed to downgrade merchant tier on-chain." }, { status: 500 });
            }
            downgradeTxHash = tx.hash;
        }

        /* 5. Update database records in a single atomic sequence */
        const { error: merchantUpdateError } = await supabase
            .from("merchants")
            .update({ tier: 0, updated_at: new Date().toISOString() })
            .eq("wallet_address", normalizedUser);

        if (merchantUpdateError) {
            console.error("Error updating merchant tier in DB:", merchantUpdateError);
        }

        const { error: subUpdateError } = await supabase
            .from("subscriptions")
            .update({
                status: "CANCELED",
                tier: 0,
                updated_at: new Date().toISOString()
            })
            .eq("subscription_id", subId);

        if (subUpdateError) {
            console.error("Error updating subscription status in DB:", subUpdateError);
        }

        return NextResponse.json({
            success: true,
            message: "Premium tier successfully deactivated.",
            downgradeTxHash
        }, { status: 200 });

    } catch (error: any) {
        console.error("Cancel premium subscription error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
