import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import fs from "node:fs";
import vm from "node:vm";
import { normalizeDatabaseUrl, getDatabaseUrl } from "../../databaseUrl.js";
import { getDatabaseConnectionConfig } from "../../databaseConnection.js";
import { SUPABASE_DB_CA_PEM } from "../../supabaseCa.js";

const dsn = authority => ["postgresql:", "", authority].join("/");
const mainnet = "jntqgoneegykgtiyvvge";
const legacy = "jkrlsjpsytzffwjpixue";
const envKeys = ["DATABASE_URL", "SUPABASE_POOLER_DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_POOLER_HOST", "SUPABASE_POOLER_PORT", "SUPABASE_DB_SSL_CA", "PRISMA_CONNECTION_LIMIT"];
function configured(values, action) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    envKeys.forEach(key => delete process.env[key]);
    Object.assign(process.env, values);
    return action();
  } finally {
    envKeys.forEach(key => { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
  }
}
test("direct database addresses preserve project host, postgres user and configured port", () => {
  for (const project of [mainnet, legacy]) configured({ SUPABASE_POOLER_HOST: "incorrect.pooler.supabase.com", SUPABASE_POOLER_PORT: "6543" }, () => {
    const url = dsn(`postgres:encoded%40password@db.${project}.supabase.co:5432/postgres?sslmode=require`);
    assert.equal(normalizeDatabaseUrl(url), url);
  });
});
test("complete pooler addresses preserve tenant, custom role, regional host and session/transaction ports", () => {
  for (const port of [5432, 6543]) configured({ SUPABASE_URL: `https://${legacy}.supabase.co`, SUPABASE_POOLER_HOST: "wrong.pooler.supabase.com", SUPABASE_POOLER_PORT: "1234" }, () => {
    const url = dsn(`app_role.${mainnet}:password@aws-0-us-east-1.pooler.supabase.com:${port}/postgres`);
    assert.equal(normalizeDatabaseUrl(url), url);
  });
});
test("incomplete pooler credentials never guess legacy tenant; explicit project URL alone can fill tenant", () => {
  const url = dsn("postgres:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres");
  configured({}, () => assert.throws(() => normalizeDatabaseUrl(url), /explicit project reference/));
  configured({ NEXT_PUBLIC_SUPABASE_URL: `https://${mainnet}.supabase.co` }, () => {
    const normalized = new URL(normalizeDatabaseUrl(url));
    assert.equal(normalized.username, `postgres.${mainnet}`);
    assert.equal(normalized.port, "5432");
    assert.equal(normalized.hostname, "aws-0-us-east-1.pooler.supabase.com");
  });
});
test("pg parses strict Supabase TLS with supplied CA despite dangerous URL SSL options", () => {
  for (const suffix of ["sslmode=require", "sslmode=disable", "ssl=false", "sslmode=require&uselibpqcompat=true", "sslrootcert=missing&sslkey=missing&sslcert=missing"]) configured({ DATABASE_URL: dsn(`postgres.${mainnet}:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?${suffix}`) }, () => {
    const config = getDatabaseConnectionConfig();
    const actual = new pg.Client(config).connectionParameters;
    assert.equal(actual.ssl.rejectUnauthorized, true);
    assert.equal(actual.ssl.ca, SUPABASE_DB_CA_PEM);
    assert.equal(actual.ssl.checkServerIdentity, undefined);
    assert.equal(actual.user, `postgres.${mainnet}`);
    assert.equal(config.connectionTimeoutMillis, 10_000);
  });
});
test("operator CA override applies equally to raw pg and Prisma driver configs", () => configured({ DATABASE_URL: dsn(`postgres:password@db.${mainnet}.supabase.co:5432/postgres?sslmode=require&connection_limit=2`), SUPABASE_DB_SSL_CA: "operator-test-ca" }, () => {
  for (const forPrisma of [false, true]) {
    const config = getDatabaseConnectionConfig({ forPrisma });
    const actual = new pg.Client(config).connectionParameters;
    assert.equal(actual.ssl.ca, "operator-test-ca");
    assert.equal(actual.ssl.rejectUnauthorized, true);
    assert.equal(config.max, 2);
    assert.equal(config.connectionTimeoutMillis, 10_000);
  }
}));
test("credentials and lookalike hosts cannot trick loopback or Supabase trust selection", () => {
  for (const host of ["localhost.evil.example", "db.project.supabase.co.evil.example", "evil-pooler.supabase.com.evil.example"]) configured({ DATABASE_URL: dsn(`localhost:127.0.0.1@${host}:5432/postgres`) }, () => {
    const config = getDatabaseConnectionConfig();
    const actual = new pg.Client(config).connectionParameters;
    assert.equal(actual.ssl.rejectUnauthorized, true);
    assert.equal(actual.ssl.ca, undefined);
  });
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) configured({ DATABASE_URL: dsn(`postgres:password@${host}:5432/postgres`) }, () => assert.equal(getDatabaseConnectionConfig().ssl, undefined));
});
test("query authority overrides are rejected before pg can silently change tenant or host", () => {
  for (const override of ["host=localhost", `user=postgres.${legacy}`, "port=1234", "database=other", "password=private-secret"]) configured({ DATABASE_URL: dsn(`postgres.${mainnet}:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?${override}`) }, () => {
    assert.throws(() => getDatabaseConnectionConfig(), error => /authority/.test(error.message) && !/private-secret/.test(error.message));
  });
});
test("missing runtime config fails closed; explicit build fallback stays local", () => configured({}, () => {
  assert.throws(() => getDatabaseUrl(), /not configured/);
  const config = getDatabaseConnectionConfig({ allowBuildTimeFallback: true });
  assert.equal(new URL(config.connectionString).hostname, "localhost");
  assert.equal(config.ssl, undefined);
}));
test("URL timeout parameters cannot disable bounded runtime statements/connections", () => configured({ DATABASE_URL: dsn(`postgres:password@db.${mainnet}.supabase.co:5432/postgres?statement_timeout=0&connect_timeout=0&connectionTimeoutMillis=0&query_timeout=0`) }, () => {
  const config = getDatabaseConnectionConfig();
  const actual = new pg.Client(config).connectionParameters;
  assert.equal(actual.statement_timeout, 15_000);
  assert.equal(actual.query_timeout, 20_000);
  assert.equal(config.connectionTimeoutMillis, 10_000);
}));
test("malformed connection URLs never expose credential-bearing inputs in errors", () => configured({ DATABASE_URL: dsn("private-password@[invalid") }, () => {
  assert.throws(() => getDatabaseConnectionConfig(), error => error.message === "Database connection URL is invalid" && !JSON.stringify(error).includes("private-password"));
}));
test("plain Node migration connection retains strict CA and migration timeout without authority ambiguity", () => {
  const source = fs.readFileSync("scripts/apply-migrations.mjs", "utf8");
  const fn = source.slice(source.indexOf("function migrationConnectionConfig("), source.indexOf("const MIGRATION_DIRS"));
  const context = vm.createContext({ URL, supabaseDbCa: () => SUPABASE_DB_CA_PEM });
  vm.runInContext(fn, context);
  const config = context.migrationConnectionConfig(dsn(`postgres:localhost@db.${mainnet}.supabase.co:5432/postgres?sslmode=disable&statement_timeout=0`));
  const actual = new pg.Client(config).connectionParameters;
  assert.equal(actual.user, "postgres");
  assert.equal(actual.ssl.rejectUnauthorized, true);
  assert.equal(actual.ssl.ca, SUPABASE_DB_CA_PEM);
  assert.equal(actual.statement_timeout, 120_000);
  assert.equal(config.connectionTimeoutMillis, 10_000);
  assert.throws(() => context.migrationConnectionConfig(dsn(`postgres:password@db.${mainnet}.supabase.co:5432/postgres?host=localhost`)), /authority/);
  assert.throws(() => context.migrationConnectionConfig(dsn("private-password@[invalid")), /URL is invalid/);
});
