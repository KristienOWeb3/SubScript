import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 removed `url` from the `datasource` block in schema.prisma: the runtime gets its
 * connection from a driver adapter (see src/lib/prisma.ts) and the CLI gets it from here. Splitting
 * them is the point of the change — the schema no longer implies that generating a client requires
 * database credentials.
 *
 * `DIRECT_URL` is preferred over `DATABASE_URL` for the same reason scripts/apply-migrations.mjs
 * prefers it: schema operations want a direct connection rather than the pgbouncer pool, which does
 * not support the session-level statements they issue.
 */
export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
    },
});
