export default function AuthSkeleton({ title = "portal", subtitle = "Loading..." }: { title?: string; subtitle?: string }) {
  return (
    <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
      <div className="relative z-10 w-full max-w-md">
        {/* Header skeleton */}
        <div className="text-center mb-8 space-y-2 flex flex-col items-center">
          <div className="flex items-center gap-2">
            <div className="h-8 w-28 rounded-xl subscript-skeleton" />
            <div className="h-8 w-16 rounded-xl subscript-skeleton" />
          </div>
          <div className="h-3 w-36 rounded-full subscript-skeleton mt-1" />
        </div>

        {/* Card skeleton */}
        <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
          {/* Card title & subtitle skeleton */}
          <div className="space-y-2 text-center flex flex-col items-center">
            <div className="h-5 w-48 rounded-xl subscript-skeleton" />
            <div className="h-3 w-64 rounded-md subscript-skeleton" />
          </div>

          {/* Input field skeleton */}
          <div className="space-y-3 pt-2">
            <div className="h-3 w-20 rounded-md subscript-skeleton" />
            <div className="h-12 w-full rounded-xl border border-black/10 bg-black/[0.02] subscript-skeleton" />
          </div>

          {/* Primary button skeleton */}
          <div className="h-12 w-full rounded-2xl bg-[#2775CA]/20 subscript-skeleton" />

          {/* Divider skeleton */}
          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-black/10" />
            <div className="h-2 w-8 rounded-full subscript-skeleton" />
            <div className="h-px flex-1 bg-black/10" />
          </div>

          {/* Secondary social/wallet button skeleton */}
          <div className="h-12 w-full rounded-2xl border border-black/10 bg-white subscript-skeleton" />
        </div>

        {/* Legal footer skeleton */}
        <div className="mt-6 text-center flex justify-center">
          <div className="h-2.5 w-60 rounded-full subscript-skeleton" />
        </div>
      </div>
    </div>
  );
}
