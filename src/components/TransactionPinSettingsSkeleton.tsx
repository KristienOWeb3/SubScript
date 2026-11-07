import Skeleton from "@/components/ui/Skeleton";
import { ShieldCheck } from "lucide-react";

export default function TransactionPinSettingsSkeleton() {
    return <div role="status" data-pin-settings-loading className="transaction-pin-settings mt-5 space-y-5">
        <span className="sr-only">Loading PIN settings…</span>
        <div aria-hidden="true" data-pin-email-loading className="space-y-4 border-t border-[#082824]/10 pt-5 dark:border-white/10">
            <p className="flex items-center gap-2 text-xs font-semibold text-[#082824]/65 dark:text-white/65"><ShieldCheck className="h-4 w-4 shrink-0 text-[#2775CA]" />Email verification</p>
            <p className="text-sm leading-relaxed"><span className="block text-xs text-[#082824]/55 dark:text-white/55">Verification email</span><span data-pin-email-placeholder className="mt-1 block break-words font-medium [overflow-wrap:anywhere]"><span className="inline-block subscript-skeleton rounded-full select-none" style={{ visibility: "hidden" }}>email@example.com</span></span></p>
            <Skeleton className="h-11 w-full rounded-xl sm:w-48" />
        </div>
    </div>;
}
