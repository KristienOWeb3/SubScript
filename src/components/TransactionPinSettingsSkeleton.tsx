import Skeleton from "@/components/ui/Skeleton";
import { ShieldCheck } from "lucide-react";

export default function TransactionPinSettingsSkeleton() {
    return <div role="status" data-pin-settings-loading className="transaction-pin-settings mt-6 space-y-5">
        <span className="sr-only">Loading PIN settings…</span>
        <div aria-hidden="true" data-pin-email-loading className="space-y-3 rounded-2xl border border-[#082824]/10 bg-white/50 p-4 dark:border-white/10 dark:bg-white/5">
            <p className="flex items-center gap-2 text-xs font-semibold text-[#082824]/65 dark:text-white/65"><ShieldCheck className="h-4 w-4 shrink-0 text-[#2775CA]" />Email verification</p>
            <p className="text-sm leading-relaxed"><span className="block text-xs text-[#082824]/55 dark:text-white/55">Verification email</span><span data-pin-email-placeholder className="inline-block subscript-skeleton rounded-full select-none"><span style={{ visibility: "hidden" }}>email@example.com</span></span></p>
            <Skeleton className="h-[42px] w-48 rounded-xl" />
        </div>
    </div>;
}
