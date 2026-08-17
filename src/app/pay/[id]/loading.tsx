import CheckoutSkeleton from "./CheckoutSkeleton";

/* Route-scoped Suspense fallback.
 *
 * Without this the checkout inherited src/app/loading.tsx, which is the dark marketing-shell
 * skeleton — so a payer opening a link saw a dark page with a glass navbar flash to a cream
 * checkout. Next.js picks the nearest loading.tsx, so this replaces it for /pay only and leaves
 * every other route on the global one.
 *
 * Deliberately mirrors the loaded checkout's own header and centred column, not just the card, so
 * the swap is invisible rather than merely quick.
 */
export default function PayLoading() {
    return (
        <div className="min-h-screen bg-[#FFFFF0] text-black flex items-center justify-center p-4 sm:p-6 font-sans">
            <div className="w-full max-w-md lg:max-w-4xl">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-[#111827] uppercase tracking-wider">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">checkout</span>
                    </h1>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-[#2775CA]/50">Loading</p>
                </div>
                <CheckoutSkeleton />
            </div>
        </div>
    );
}
