import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Prioritize .env which has the LIVE_API_KEY
const envConfig = dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), ".env")));

const apiKey = envConfig.CIRCLE_API_KEY;
const entitySecret = envConfig.CIRCLE_ENTITY_SECRET;

if (!apiKey || !entitySecret) {
    console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env");
    process.exit(1);
}

console.log("Using API Key starting with:", apiKey.slice(0, 15) + "...");

const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
});

async function main() {
    console.log("Calling Circle API to create wallet set...");
    const response = await client.createWalletSet({
        name: "SubScript Production Wallets",
    });

    const walletSet = response.data?.walletSet;
    if (!walletSet?.id) {
        console.error("Failed to create wallet set. Response:", response);
        process.exit(1);
    }

    console.log("\n=======================================================");
    console.log("SUCCESS! Created Circle Production Wallet Set:");
    console.log("Wallet Set ID:", walletSet.id);
    console.log("Wallet Set Name:", walletSet.name);
    console.log("=======================================================\n");

    return walletSet.id;
}

main().catch((err) => {
    console.error("Circle Wallet Set creation failed:", err?.message || err);
    if (err?.response?.data) {
        console.error("API error response:", err.response.data);
    }
    process.exit(1);
});
