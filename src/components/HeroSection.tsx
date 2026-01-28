export default function HeroSection() {
    return (
        <div className="flex flex-col justify-center">
            {/* Headline */}
            <h1 className="text-5xl md:text-6xl font-bold text-white italic mb-6">
                A New Way to Pay
            </h1>

            {/* Description */}
            <p className="text-gray-400 text-lg leading-relaxed mb-8 max-w-md">
                SubScript is the best platform to automate your crypto life, manage recurring expenses, and handle subscriptions on-chain.
            </p>

            {/* CTA Button */}
            <div>
                <button className="btn-glow bg-gradient-to-r from-teal-500 to-teal-400 text-white font-semibold px-8 py-4 rounded-full flex items-center gap-2 hover:from-teal-400 hover:to-teal-300 transition-all">
                    Create Account
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                        />
                    </svg>
                </button>
            </div>
        </div>
    )
}
