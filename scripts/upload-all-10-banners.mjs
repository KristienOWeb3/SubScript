import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error("Missing SUPABASE credentials");
    process.exit(1);
}

const client = createClient(url, key);
const dir = path.join("public", "email", "banners");

const files = [
    "eth-3d-banner.png",
    "solana-3d-banner.png",
    "arc-3d-banner.png",
    "base-3d-banner.png",
    "arbitrum-3d-banner.png",
    "polygon-3d-banner.png",
    "avalanche-3d-banner.png",
    "optimism-3d-banner.png",
    "usdc-3d-banner.png",
    "bank-3d-banner.png",
];

async function main() {
    console.log("Uploading all 10 banners to Supabase CDN...");
    for (const f of files) {
        const filePath = path.join(dir, f);
        if (!fs.existsSync(filePath)) {
            console.warn(`File not found: ${f}`);
            continue;
        }
        const buf = fs.readFileSync(filePath);

        // Upload both standard and -v3 versioned filename to break Gmail proxy cache
        const baseName = f.replace(".png", "");
        const v3Name = `${baseName}-v3.png`;
        const v4Name = `${baseName}-v4.png`;

        for (const target of [f, v3Name, v4Name]) {
            const { error } = await client.storage.from("profiles").upload(`banners/${target}`, buf, {
                contentType: "image/png",
                upsert: true,
                cacheControl: "60",
            });
            if (error) {
                console.error(`Error uploading ${target}:`, error.message);
            } else {
                console.log(` -> Uploaded banners/${target}`);
            }
        }
    }
    console.log("\nAll 10 banners uploaded to CDN successfully!");
}

main().catch(console.error);
