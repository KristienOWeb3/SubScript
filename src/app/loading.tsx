export default function GlobalLoading() {
  return (
    <div
      aria-label="Loading SubScript..."
      className="min-h-screen w-full bg-black text-[#FFFFF0] flex flex-col items-center justify-start overflow-x-hidden selection:bg-[#00d2b4]/30"
    >
      {/* Top Floating Navbar Skeleton */}
      <header className="fixed top-5 left-0 right-0 z-40 px-4 sm:px-6 flex justify-center pointer-events-none">
        <div className="w-full max-w-5xl liquid-glass rounded-full px-6 py-3.5 flex items-center justify-between pointer-events-auto bg-black/60 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full subscript-skeleton bg-white/10" />
            <div className="w-24 h-4 rounded-md subscript-skeleton bg-white/10" />
          </div>
          <div className="hidden lg:flex items-center gap-6">
            <div className="w-20 h-3 rounded subscript-skeleton bg-white/10" />
            <div className="w-16 h-3 rounded subscript-skeleton bg-white/10" />
            <div className="w-16 h-3 rounded subscript-skeleton bg-white/10" />
            <div className="w-16 h-3 rounded subscript-skeleton bg-white/10" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-20 h-8 rounded-full subscript-skeleton bg-[#00d2b4]/20" />
            <div className="h-8 w-8 rounded-full subscript-skeleton bg-white/10 lg:hidden" />
          </div>
        </div>
      </header>

      {/* Hero Section Skeleton */}
      <main className="w-full max-w-4xl mx-auto px-6 sm:px-12 pt-36 sm:pt-44 pb-16 flex flex-col items-center text-center">
        {/* Title skeleton */}
        <div className="w-full max-w-3xl space-y-3 mb-6 flex flex-col items-center">
          <div className="h-10 sm:h-14 w-4/5 rounded-2xl subscript-skeleton bg-white/10" />
          <div className="h-10 sm:h-14 w-3/5 rounded-2xl subscript-skeleton bg-[#00d2b4]/15" />
        </div>

        {/* Subtitle skeleton */}
        <div className="w-full max-w-xl space-y-2 mb-10 flex flex-col items-center">
          <div className="h-4 w-full rounded-md subscript-skeleton bg-white/10" />
          <div className="h-4 w-4/5 rounded-md subscript-skeleton bg-white/10" />
        </div>

        {/* CTA buttons skeleton */}
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto items-center justify-center mb-16">
          <div className="h-12 w-40 rounded-2xl subscript-skeleton bg-[#00d2b4]/30" />
          <div className="h-12 w-44 rounded-2xl subscript-skeleton bg-white/10 border border-white/10" />
        </div>

        {/* Bento Grid cards skeleton */}
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-6 gap-6 text-left">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`p-6 rounded-3xl border border-white/10 bg-white/[0.03] flex flex-col justify-between liquid-glass-skeleton ${i <= 2 ? "min-h-[240px] md:col-span-3" : "min-h-[180px] md:col-span-2"}`}
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-2xl subscript-skeleton bg-white/10 mb-4" />
                <div className="h-5 w-3/4 rounded-md subscript-skeleton bg-white/15" />
                <div className="h-3.5 w-full rounded subscript-skeleton bg-white/10" />
                <div className="h-3.5 w-4/5 rounded subscript-skeleton bg-white/10" />
              </div>
              <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                <div className="h-3 w-16 rounded subscript-skeleton bg-white/10" />
                <div className="h-3 w-6 rounded subscript-skeleton bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
