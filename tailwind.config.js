/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            /* Tailwind's default scale jumps from 4 (1rem) to 5 (1.25rem) with no 4.5, so the
               `h-4.5 w-4.5` icon sizing used across the sidebars, the withdraw modal, and the
               premium diamond button compiled to nothing and those icons fell back to their
               intrinsic size. 1.125rem keeps the step consistent with the 0.5 increments Tailwind
               already ships lower down the scale. */
            spacing: {
                '4.5': '1.125rem',
            },
            colors: {
                'dark-charcoal': '#1e1e1e',
                'dark-slate': '#262626',
                'leetcode-teal': '#00b8a3',
                'muted-gray': '#a1a1aa',
            },
            fontFamily: {
                sans: ['var(--font-sukar)', 'Sukar', 'sans-serif'],
                serif: ['var(--font-sukar)', 'Sukar', 'sans-serif'],
                mono: ['var(--font-sukar)', 'Sukar', 'sans-serif'],
            },
            transitionTimingFunction: {
                DEFAULT: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
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
