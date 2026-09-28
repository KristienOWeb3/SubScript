import { IncomingTransactionIcon, OutgoingTransactionIcon } from "@/components/icons";
import { getRecognizedAccountName, type TransactionDirection } from "@/lib/transactions/identity";

type TransactionAvatarProps = {
  className?: string;
  direction: TransactionDirection;
  displayName?: string | null;
  identityName?: string | null;
  profilePic?: string | null;
};

export function TransactionAvatar({
  className = "h-10 w-10 rounded-full",
  direction,
  displayName,
  identityName,
  profilePic,
}: TransactionAvatarProps) {
  const recognizedName = getRecognizedAccountName(identityName, profilePic ? displayName : null);
  const directionLabel = direction === "incoming"
    ? "Received from external wallet"
    : "Sent to external wallet";

  if (profilePic) {
    return (
      <div className={`${className} shrink-0 overflow-hidden border border-black/10 dark:border-white/10`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={profilePic} alt={displayName || recognizedName || "SubScript account"} className="h-full w-full object-cover" />
      </div>
    );
  }

  if (recognizedName) {
    const initial = recognizedName.match(/[a-zA-Z0-9]/)?.[0]?.toUpperCase() || "?";
    return (
      <div
        className={`${className} flex shrink-0 items-center justify-center border border-black/10 bg-[#2775CA]/10 text-sm font-black text-[#2775CA] dark:border-white/10 dark:bg-white/5 dark:text-[#ccff00]`}
        title={recognizedName}
      >
        {initial}
      </div>
    );
  }

  const Icon = direction === "incoming" ? IncomingTransactionIcon : OutgoingTransactionIcon;
  const directionClasses = direction === "incoming"
    ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
    : "bg-[#2775CA]/10 text-[#2775CA] dark:bg-blue-400/10 dark:text-blue-300";

  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center border border-current/20 ${directionClasses}`}
      title={directionLabel}
    >
      <Icon className="h-[58%] w-[58%]" aria-hidden="true" focusable="false" />
      <span className="sr-only">{directionLabel}</span>
    </div>
  );
}

export default TransactionAvatar;

