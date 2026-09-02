import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const ROUTE = "src/app/api/admin/referrals/route.ts";
const VIEW = "src/components/admin/AdminReferralsView.tsx";
const ADMIN_PAGE = "src/app/admin/page.tsx";

test("admin referrals route is protected with read scope guard", () => {
  const route = source(ROUTE);

  // Must call requireScope with "read" scope
  assert.match(route, /requireScope\(request,\s*["']read["']\)/);
  assert.doesNotMatch(route, /await requireAdmin\(/);
});

test("referrals tab is present in admin navigation and rendered correctly", () => {
  const page = source(ADMIN_PAGE);

  // TabId includes referrals
  assert.match(page, /\|\s*"referrals"/);

  // TABS array includes referrals
  assert.match(page, /\{\s*id:\s*"referrals",\s*label:\s*"Referral Leaderboard"\s*\}/);

  // adminSidebarItems includes referrals
  assert.match(page, /\{\s*id:\s*"referrals",\s*label:\s*"Referrals",\s*icon:\s*Trophy\s*\}/);

  // Tab view is rendered
  assert.match(page, /\{tab === "referrals" && <AdminReferralsView[^>]*\/>\}/);
});

test("admin referrals view implements leaderboard ranking and CSV export", () => {
  const view = source(VIEW);

  // View supports search and timeframe filters
  assert.match(view, /searchQuery/);
  assert.match(view, /timeframe/);
  assert.match(view, /sortBy/);

  // View supports CSV export functions
  assert.match(view, /exportLeaderboardCsv/);
  assert.match(view, /exportAllReferralsCsv/);

  // View renders summary cards, leaderboard table and expanded drill-down
  assert.match(view, /Referred Address/);
  assert.match(view, /KYC Status/);
  assert.match(view, /Settled Volume/);
});

test("referrals route queries database with serialized pool protection", () => {
  const route = source(ROUTE);

  // Uses runAdminQueriesSequentially to prevent pool starvation
  assert.match(route, /runAdminQueriesSequentially/);

  // Queries referrals table
  assert.match(route, /prisma\.referral\.findMany/);

  // Joins aliases, KYC, and settled receipts
  assert.match(route, /prisma\.addressAlias\.findMany/);
  assert.match(route, /prisma\.kycVerification\.findMany/);
  assert.match(route, /prisma\.receipt\.findMany/);
});
