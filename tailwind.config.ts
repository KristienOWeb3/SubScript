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
                'dark-bg': '#0f0f0f',
                'card-bg': '#1a1a1a',
                'card-border': '#2a2a2a',
                'teal-primary': '#2dd4bf',
                'teal-dark': '#14b8a6',
                'accent-red': '#ef4444',
                'accent-green': '#22c55e',
                'accent-blue': '#3b82f6',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            },
            boxShadow: {
                'glow-teal': '0 0 40px rgba(45, 212, 191, 0.4)',
                'glow-green': '0 0 10px rgba(34, 197, 94, 0.3)',
            },
        },
    },
    plugins: [],
}
export default config
