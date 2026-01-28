/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                'dark-charcoal': '#1e1e1e',
                'dark-slate': '#262626',
                'leetcode-teal': '#00b8a3',
                'muted-gray': '#a1a1aa',
            },
            fontFamily: {
                sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
            },
            animation: {
                'float': 'float 6s ease-in-out infinite',
            },
            keyframes: {
                float: {
                    '0%, 100%': { transform: 'translateY(0px) rotateX(8deg) rotateY(-18deg) rotateZ(2deg)' },
                    '50%': { transform: 'translateY(-15px) rotateX(8deg) rotateY(-18deg) rotateZ(2deg)' },
                },
            },
        },
    },
    plugins: [],
};
