import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RouteContext = {
    params: Promise<{ tokenId: string }>;
};

function generateSvg({ tokenId, subscriptionId, merchant, subscriber, amount, status, tier }: any) {
    const statusColor = status === "ACTIVE" ? "#10B981" : "#EF4444";
    const statusText = status === "ACTIVE" ? "ACTIVE" : "EXPIRED";
    const shortMerchant = merchant.slice(0, 6) + "..." + merchant.slice(-4);
    const shortSubscriber = subscriber.slice(0, 6) + "..." + subscriber.slice(-4);
    const tierText = tier === 1 ? "Premium" : "Standard";

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="100%" height="100%">
        <defs>
            <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#0F172A" />
                <stop offset="100%" stop-color="#1E293B" />
            </linearGradient>
            <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#6366F1" />
                <stop offset="50%" stop-color="#EC4899" />
                <stop offset="100%" stop-color="#3B82F6" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="15" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
        </defs>
        
        /* Base Card */
        <rect x="10" y="10" width="380" height="580" rx="24" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="3" />
        
        /* Glowing Accent */
        <circle cx="200" cy="150" r="80" fill="#6366F1" opacity="0.15" filter="url(#glow)" />
        
        /* Grid overlay */
        <path d="M 10 100 L 390 100 M 10 200 L 390 200 M 10 300 L 390 300 M 10 400 L 390 400 M 10 500 L 390 500" stroke="#334155" stroke-width="0.5" opacity="0.3" />
        <path d="M 100 10 L 100 590 M 200 10 L 200 590 M 300 10 L 300 590" stroke="#334155" stroke-width="0.5" opacity="0.3" />

        /* Header */
        <text x="40" y="60" fill="#F8FAFC" font-family="'Outfit', 'Inter', sans-serif" font-size="20" font-weight="800" letter-spacing="1">SUBSCRIPT</text>
        <text x="360" y="60" text-anchor="end" fill="#94A3B8" font-family="'Inter', sans-serif" font-size="12" font-weight="600">SBT KEY</text>
        
        /* Token ID Graphic */
        <text x="200" y="170" text-anchor="middle" fill="#FFFFFF" font-family="'Outfit', 'Inter', sans-serif" font-size="64" font-weight="900" letter-spacing="-2">#${tokenId}</text>
        
        /* Status Badge */
        <g transform="translate(140, 210)">
            <rect x="0" y="0" width="120" height="30" rx="15" fill="${statusColor}" opacity="0.2" />
            <rect x="0" y="0" width="120" height="30" rx="15" stroke="${statusColor}" stroke-width="1.5" fill="none" />
            <text x="60" y="19" text-anchor="middle" fill="${statusColor}" font-family="'Inter', sans-serif" font-size="12" font-weight="800" letter-spacing="1.5">${statusText}</text>
        </g>
        
        /* Details Section */
        <g transform="translate(40, 290)">
            <text x="0" y="0" fill="#94A3B8" font-family="'Inter', sans-serif" font-size="11" font-weight="600" letter-spacing="0.5">SUBSCRIPTION ID</text>
            <text x="0" y="22" fill="#F1F5F9" font-family="'Inter', sans-serif" font-size="15" font-weight="700">${subscriptionId}</text>
            
            <text x="0" y="60" fill="#94A3B8" font-family="'Inter', sans-serif" font-size="11" font-weight="600" letter-spacing="0.5">TIER LEVEL</text>
            <text x="0" y="82" fill="#F1F5F9" font-family="'Inter', sans-serif" font-size="15" font-weight="700">${tierText}</text>
            
            <text x="0" y="120" fill="#94A3B8" font-family="'Inter', sans-serif" font-size="11" font-weight="600" letter-spacing="0.5">MERCHANT ADDRESS</text>
            <text x="0" y="142" fill="#6366F1" font-family="'Courier New', monospace" font-size="14" font-weight="700">${shortMerchant}</text>
            
            <text x="0" y="180" fill="#94A3B8" font-family="'Inter', sans-serif" font-size="11" font-weight="600" letter-spacing="0.5">SUBSCRIBER ADDRESS</text>
            <text x="0" y="202" fill="#EC4899" font-family="'Courier New', monospace" font-size="14" font-weight="700">${shortSubscriber}</text>
            
            <text x="0" y="240" fill="#94A3B8" font-family="'Inter', sans-serif" font-size="11" font-weight="600" letter-spacing="0.5">VALUE LIMIT</text>
            <text x="0" y="262" fill="#F1F5F9" font-family="'Inter', sans-serif" font-size="15" font-weight="700">${amount} USDC</text>
        </g>
        
        /* Footer */
        <text x="200" y="560" text-anchor="middle" fill="#475569" font-family="'Inter', sans-serif" font-size="10" font-weight="600" letter-spacing="0.5">SOULBOUND ACCESS KEY • NON-TRANSFERABLE</text>
    </svg>`;
}

export async function GET(request: Request, { params }: RouteContext) {
    try {
        const { tokenId } = await params;
        if (!tokenId || isNaN(Number(tokenId))) {
            return NextResponse.json({ error: "Bad Request: Invalid token ID" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Query subscriptions by the indexed sbt_token_id column for O(1) performance */
        const { data: sub, error: subError } = await supabase
            .from("subscriptions")
            .select("*")
            .eq("sbt_token_id", tokenId)
            .maybeSingle();

        if (subError) {
            console.error("Error querying subscription by sbt_token_id:", subError.message);
            return NextResponse.json({ error: subError.message }, { status: 500 });
        }

        if (!sub) {
            return NextResponse.json({ error: "Token not found" }, { status: 404 });
        }

        /* Retrieve the original subscriber address from sbt_mint_jobs */
        const { data: mintJob, error: jobError } = await supabase
            .from("sbt_mint_jobs")
            .select("recipient_address")
            .eq("subscription_id", sub.subscription_id)
            .maybeSingle();

        if (jobError) {
            console.warn("Error fetching subscriber recipient address from mint jobs:", jobError.message);
        }

        const subscriberAddress = mintJob ? mintJob.recipient_address : "0x0000000000000000000000000000000000000000";

        /* Generate premium dynamic SVG card */
        const svgContent = generateSvg({
            tokenId,
            subscriptionId: sub.subscription_id.toString(),
            merchant: sub.merchant_address,
            subscriber: subscriberAddress,
            amount: sub.amount_cap_usdc,
            status: sub.status,
            tier: Number(sub.tier || 0)
        });

        const base64Svg = Buffer.from(svgContent).toString("base64");
        const imageDataUrl = `data:image/svg+xml;base64,${base64Svg}`;

        /* Format OpenSea-compliant metadata JSON */
        const metadata = {
            name: `SubScript Soulbound Access Key #${tokenId}`,
            description: "This soulbound token represents an active access key to a merchant service registered under the SubScript protocol.",
            image: imageDataUrl,
            attributes: [
                {
                    trait_type: "Status",
                    value: sub.status === "ACTIVE" ? "Active" : "Expired"
                },
                {
                    trait_type: "Subscription ID",
                    value: sub.subscription_id.toString()
                },
                {
                    trait_type: "Tier",
                    value: sub.tier === 1 ? "Premium" : "Standard"
                },
                {
                    trait_type: "Merchant",
                    value: sub.merchant_address
                },
                {
                    trait_type: "Subscriber",
                    value: subscriberAddress
                },
                {
                    display_type: "date",
                    trait_type: "Expiration",
                    value: sub.last_settlement_timestamp ? Math.floor(new Date(sub.last_settlement_timestamp).getTime() / 1000) : null
                }
            ]
        };

        const response = NextResponse.json(metadata, { status: 200 });
        
        /* Configure caching headers as per design spec */
        response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

        return response;

    } catch (error: any) {
        console.error("SBT metadata endpoint error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
