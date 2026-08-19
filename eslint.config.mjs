import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * Flat config, replacing .eslintrc.json.
 *
 * Next 16 removed `next lint`, which is what `npm run lint` used to call and what CI runs, so the
 * script now invokes the ESLint CLI directly. The CLI reads flat config, and eslint-config-next 16
 * exports `core-web-vitals` as a flat array, so the old `extends: "next/core-web-vitals"` becomes a
 * spread. `.mjs` rather than `.js` because this package has no `"type": "module"`, so a `.js` config
 * would be loaded as CommonJS and these imports would fail.
 *
 * `next lint` used to supply the ignore list and the set of files to walk. Both are explicit here:
 * flat config ignores only node_modules and .git by default, so everything the old `ignorePatterns`
 * covered has to be restated or the CLI will happily lint build output and generated contract typings.
 */
export default [
    {
        ignores: [
            /* Build output, ours and any nested copy of it. */
            ".next/**",
            "**/.next/**",
            "out/**",
            "output/**",
            "build/**",
            "**/dist/**",
            "coverage/**",
            /* Orphaned agent worktrees. These are full copies of the repo, build output included, and
               git does not track them, so linting them reports thousands of problems in code that is
               not in this branch and cannot be fixed from it. */
            ".claude/**",
            /* The Flutter app, including its compiled web bundle — canvaskit.js and skwasm.js are
               minified Skia vendor code that trips react-hooks and display-name rules in volume. */
            "mobile/**",
            /* Workspaces with their own toolchains and lint setups. */
            "packages/**",
            "mcp-server/**",
            /* Solidity sources plus everything Hardhat generates from them. */
            "contracts/**",
            "artifacts/**",
            "cache/**",
            "typechain-types/**",
            /* Throwaway diagnostics and operational scripts; not shipped, not held to app rules. */
            "scratch/**",
            "scripts/**",
            "script/**",
            "recovery/**",
            "prisma/generated/**",
        ],
    },
    ...nextCoreWebVitals,
    {
        name: "subscript/overrides",
        rules: {
            /* Apostrophes and quotes in copy read fine and the escapes hurt legibility in source. */
            "react/no-unescaped-entities": "off",

            /* eslint-plugin-react-hooks 7, which arrived with Next 16, ships the React Compiler
               readiness rules as errors. On this codebase that is 99 findings — 87 of them
               set-state-in-effect, which flags the ordinary mount-flag and hydration-guard pattern
               used throughout the dashboards.
               These are warnings rather than errors deliberately. They describe work worth doing
               before adopting the compiler, but none of them is a defect today, and leaving them as
               errors would either block CI or force 99 behavioural edits into a version bump — the
               riskiest possible way to make them. Warning keeps every finding visible and greppable
               so the backlog can be burned down on purpose.
               Note what is NOT downgraded: rules-of-hooks stays an error. It catches real bugs and
               currently reports none in src, so it is a live guard rather than a backlog. */
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/purity": "warn",
            "react-hooks/immutability": "warn",
            "react-hooks/error-boundaries": "warn",
        },
    },
];
