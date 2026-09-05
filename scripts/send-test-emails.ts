import {
    sendDepositReceivedEmail,
    sendWithdrawalCompletedEmail,
} from "../src/lib/email/transactional";

async function main() {
    const targetEmail = "0xKristien@gmail.com";
    console.log(`\n========================================`);
    console.log(`Dispatching fresh test emails to: ${targetEmail}`);
    console.log(`========================================\n`);

    const results: Array<{ chain: string; ok: boolean; id?: string | null; error?: string }> = [];

    const testDeposits = [
        { chain: "Ethereum", amount: "260000000", label: "Ethereum Deposit (260 USDC)" },
        { chain: "Solana", amount: "150000000", label: "Solana Deposit (150 USDC)" },
        { chain: "Arc Network", amount: "500000000", label: "Arc Network Deposit (500 USDC)" },
        { chain: "Base", amount: "75000000", label: "Base Deposit (75 USDC)" },
        { chain: "Arbitrum", amount: "120000000", label: "Arbitrum Deposit (120 USDC)" },
        { chain: "USDC", amount: "300000000", label: "USDC Universal Deposit (300 USDC)" },
    ];

    for (let i = 0; i < testDeposits.length; i++) {
        const item = testDeposits[i];
        try {
            console.log(`[${i + 1}/${testDeposits.length}] Sending ${item.label}...`);
            const id = await sendDepositReceivedEmail({
                recipientEmail: targetEmail,
                recipientName: "Kristien",
                amountUsdc: item.amount,
                originChainName: item.chain,
                txHash: `0x${item.chain.toLowerCase().replace(/[^a-z0-9]/g, "")}_${Date.now()}`,
                receivedAt: new Date(),
            });
            console.log(`  -> Sent! Resend ID: ${id}`);
            results.push({ chain: item.label, ok: true, id });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  -> Failed: ${msg}`);
            results.push({ chain: item.label, ok: false, error: msg });
        }
    }

    console.log(`\n========================================`);
    console.log(`Email Dispatch Summary:`);
    console.table(results);
    console.log(`========================================\n`);
}

main().catch((err) => {
    console.error("Fatal dispatch error:", err);
    process.exit(1);
});
