const subscriptions = [
    { name: 'Netflix', price: '$15.99 USDC / mo', status: 'Active' },
    { name: 'Vercel Pro', price: '$20.00 USDC / mo', status: 'Active' },
    { name: 'Spotify', price: '$9.99 USDC / mo', status: 'Active' },
    { name: 'GitHub Copilot', price: '$10.00 USDC / mo', status: 'Active' },
]

export default function DashboardCard() {
    return (
        <div className="perspective-container">
            <div className="card-3d bg-[#1a1a1a] rounded-2xl p-5 w-[320px] border border-[#2a2a2a] shadow-2xl">
                {/* Window dots */}
                <div className="flex gap-2 mb-5">
                    <div className="w-3 h-3 rounded-full bg-teal-500"></div>
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                </div>

                {/* Widget row */}
                <div className="flex gap-3 mb-5">
                    <div className="w-16 h-16 bg-teal-500 rounded-xl"></div>
                    <div className="w-16 h-16 bg-red-500 rounded-xl"></div>
                    <div className="w-16 h-16 bg-green-500 rounded-xl"></div>
                    {/* Pie chart */}
                    <div className="w-16 h-16 rounded-full border-4 border-blue-500 relative overflow-hidden">
                        <div className="absolute inset-0 bg-blue-500 pie-chart-half"></div>
                    </div>
                </div>

                {/* Subscription list */}
                <div className="flex flex-col gap-2">
                    {subscriptions.map((sub, index) => (
                        <div
                            key={index}
                            className="flex items-center justify-between bg-[#222222] rounded-lg px-4 py-3 border-l-2 border-green-500 glow-green-border"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                <div>
                                    <div className="text-white text-sm font-medium">{sub.name}</div>
                                    <div className="text-gray-500 text-xs">{sub.price}</div>
                                </div>
                            </div>
                            <span className="text-green-500 text-xs font-medium bg-green-500/10 px-2 py-1 rounded">
                                {sub.status}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
