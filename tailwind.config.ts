import type { Config } from 'tailwindcss'

const config: Config = {
    content: [
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            colors: {
                'dark-bg-start': '#111111',
                'dark-bg-end': '#1a1b1e',
                'card-bg': '#27272a',
                'card-border': '#3f3f46',
                'accent-teal': '#00d2b4',
                'accent-gold': '#d4a853',
                'text-secondary': '#9ca3af',
                'accent-red': '#ef4444',
                'accent-green': '#22c55e',
                'accent-blue': '#3b82f6',
            },
            fontFamily: {
                sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
                serif: ['var(--font-instrument)', 'Georgia', 'serif'],
            },
            boxShadow: {
                'glow-teal': '0 0 25px rgba(0, 210, 180, 0.4)',
                'glow-gold': '0 0 25px rgba(212, 168, 83, 0.3)',
                'glow-green': '0 0 10px rgba(34, 197, 94, 0.3)',
            },
        },
    },
    plugins: [],
}
export default config
