/* Tailwind 4 ships its own PostCSS plugin, and autoprefixer is no longer needed — vendor prefixing
   is handled internally, and running both duplicates work.
   Note postcss.config.mjs and tailwind.config.ts also exist in the repo root and are dead: PostCSS
   and Tailwind resolve .js first, so edits to the twins have never had any effect. They are removed
   in this change so the next theme edit lands somewhere that runs. */
module.exports = {
    plugins: {
        "@tailwindcss/postcss": {},
    },
};
