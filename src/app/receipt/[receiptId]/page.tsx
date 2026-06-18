import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isReceiptId } from "@/lib/arc/memo";

type PageProps = {
    params: Promise<{ receiptId: string }>;
};

function formatAddress(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsdc(value: string | number | bigint) {
    return (Number(value) / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export default async function ReceiptPage({ params }: PageProps) {
    const { receiptId } = await params;
    if (!isReceiptId(receiptId) || !supabaseAdmin) {
        notFound();
    }

    const { data: receipt } = await supabaseAdmin
        .from("receipts")
        .select("*")
        .eq("receipt_id", receiptId)
        .maybeSingle();

    if (!receipt) {
        notFound();
    }

    const paidAt = receipt.confirmed_at || receipt.created_at;
    const claimHref = `/signup?next=/dashboard/user&claimReceipt=${encodeURIComponent(receiptId)}`;

    return (
        <main className="min-h-screen bg-[#060608] text-white px-6 py-10 flex items-center justify-center">
            <section className="w-full max-w-lg border border-white/10 bg-white/[0.03] rounded-3xl p-6 sm:p-8 shadow-2xl space-y-8">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] text-white/40">SubScript Receipt</p>
                        <h1 className="mt-2 text-2xl font-black tracking-tight break-words">{receipt.receipt_id}</h1>
                    </div>
                    <div className="rounded-2xl bg-emerald-400/10 border border-emerald-400/20 p-3 text-emerald-300">
                        <CheckCircle2 className="h-6 w-6" />
                    </div>
                </div>

                <div className="grid gap-4">
                    <div className="border border-white/10 rounded-2xl p-5 bg-black/20">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Amount</p>
                        <p className="mt-1 text-4xl font-black text-[#ccff00]">${formatUsdc(receipt.amount_usdc)} USDC</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="border border-white/10 rounded-2xl p-4 bg-black/20">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Sender</p>
                            <p className="mt-1 font-mono text-white/85">{formatAddress(receipt.payer_address)}</p>
                        </div>
                        <div className="border border-white/10 rounded-2xl p-4 bg-black/20">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Date</p>
                            <p className="mt-1 text-white/85">{new Date(paidAt).toLocaleString()}</p>
                        </div>
                    </div>

                    <div className="border border-white/10 rounded-2xl p-4 bg-black/20">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Memo note</p>
                        <p className="mt-1 text-white/85 break-words">{receipt.memo_note || receipt.receipt_id}</p>
                    </div>
                </div>

                <div className="rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 p-5 space-y-4">
                    <p className="text-sm leading-relaxed text-white/85">
                        Alex paid for this using SubScript. Click here to Continue with Google and claim your SubScript account.
                    </p>
                    <Link
                        href={claimHref}
                        className="w-full rounded-xl bg-[#ccff00] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 hover:bg-[#ccff00]/90 transition"
                    >
                        Continue with Google
                        <ExternalLink className="h-4 w-4" />
                    </Link>
                </div>
            </section>
        </main>
    );
}
