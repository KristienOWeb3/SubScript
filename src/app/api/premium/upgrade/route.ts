import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const PAYMENT_RECIPIENT = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";

export async function POST(request: Request) {
    try {
        /* 1. Authenticate the merchant session */
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please connect your wallet first." }, { status: 401 });
        }

        /* 2. Parse body parameters */
        const body = await request.json();
        const { txHash } = body;

        if (!txHash || !txHash.startsWith("0x") || txHash.length !== 66) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid transaction hash" }, { status: 400 });
        }

        /* 3. Connect to network using admin key */
        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;

        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

        /* 4. Retrieve and verify the payment transaction receipt */
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) {
            return NextResponse.json({ error: "Transaction receipt not found. Please try again in a few seconds." }, { status: 404 });
        }

        if (Number(receipt.status) !== 1) {
            return NextResponse.json({ error: "Transaction failed or reverted on-chain" }, { status: 400 });
        }

        /* Verify the sender is the authenticated merchant wallet */
        if (receipt.from.toLowerCase() !== walletAddress.toLowerCase()) {
            return NextResponse.json({ error: "Forbidden: Transaction sender does not match connected wallet" }, { status: 403 });
        }

        /* 5. Parse receipt logs for the Transfer event */
        /* ERC-20 Transfer signature: Transfer(address indexed from, address indexed to, uint256 value) */
        const transferTopic = ethers.id("Transfer(address,address,uint256)");
        let paymentVerified = false;

        for (const log of receipt.logs) {
            /* Check if log is from the USDC address */
            if (log.address.toLowerCase() === USDC_NATIVE_GAS_ADDRESS.toLowerCase()) {
                /* Check if it is a Transfer event */
                if (log.topics[0] === transferTopic) {
                    const fromAddr = ethers.getAddress("0x" + log.topics[1].slice(26));
                    const toAddr = ethers.getAddress("0x" + log.topics[2].slice(26));
                    /* Parse the 256-bit unsigned integer value */
                    const value = ethers.toBigInt(log.data);

                    /* Check sender, receiver, and amount (10 USDC has 6 decimals = 10,000,000) */
                    if (
                        fromAddr.toLowerCase() === walletAddress.toLowerCase() &&
                        toAddr.toLowerCase() === PAYMENT_RECIPIENT.toLowerCase() &&
                        value === ethers.parseUnits("10", 6)
                    ) {
                        paymentVerified = true;
                        break;
                    }
                }
            }
        }

        if (!paymentVerified) {
            return NextResponse.json({ error: "Verification Failed: 10 USDC transfer to recipient not found in transaction logs" }, { status: 400 });
        }

        /* 6. Submit the tier upgrade transaction on-chain */
        console.log(`[Premium Upgrade] Upgrading merchant ${walletAddress} to Premium...`);
        const contract = new ethers.Contract(
            SUBSCRIPT_ROUTER_ADDRESS,
            [
                "function setMerchantTier(address _merchant, uint8 _tier) external",
                "function merchantTiers(address) view returns (uint8)"
            ],
            adminWallet
        );

        /* Send transaction */
        const upgradeTx = await contract.setMerchantTier(walletAddress, 1);
        console.log(`[Premium Upgrade] Upgrade tx sent: ${upgradeTx.hash}`);
        
        /* Wait for confirmation */
        const upgradeReceipt = await upgradeTx.wait();
        if (upgradeReceipt.status !== 1) {
            return NextResponse.json({ error: "On-chain admin upgrade transaction failed" }, { status: 500 });
        }

        console.log(`[Premium Upgrade] Merchant ${walletAddress} successfully upgraded on-chain!`);

        /* 7. Sync with Supabase database to set tier to Premium (1) */
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (supabaseUrl && supabaseServiceKey) {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                const { error: dbError } = await supabase
                    .from("merchants")
                    .upsert({
                        wallet_address: walletAddress.toLowerCase(),
                        tier: 1
                    }, { onConflict: "wallet_address" });

                if (dbError) {
                    console.error("[Premium Upgrade] Database sync error:", dbError);
                } else {
                    console.log(`[Premium Upgrade] Merchant ${walletAddress} tier updated to 1 (Premium) in database.`);
                }
            } catch (dbErr) {
                console.error("[Premium Upgrade] Database client error:", dbErr);
            }
        }

        return NextResponse.json({ success: true, tier: 1 }, { status: 200 });
    } catch (error: any) {
        console.error("Premium upgrade error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
