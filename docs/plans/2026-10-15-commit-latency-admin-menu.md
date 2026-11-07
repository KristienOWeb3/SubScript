# Admin Commit Latency Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide an interactive "Commit Latency" menu and live telemetry dashboard in the SubScript Admin console under the System group, reporting unified real-time commit latency across Protocol Vault Commits, Database transaction commits, and Arc RPC block write latency.

**Architecture:** 
1. Build a high-performance, scope-gated API endpoint (`GET /api/admin/system/commit-latency`) that probes raw PostgreSQL transaction commit latency (`BEGIN ... COMMIT`), Arc RPC block write/read latency, and calculates statistical distributions (Average, P50, P95, Min, Max, in-flight/pending count) across recent `VaultCommitIntent` protocol commitments.
2. Build `AdminCommitLatencyView.tsx` with live metric cards, lifecycle latency breakdown, status badges, auto-refresh polling controls, manual benchmark triggers, and a searchable recent commits feed.
3. Wire `"commit-latency"` into `src/app/admin/page.tsx` tabs and the `System` sidebar navigation group.
4. Add comprehensive test coverage and update `docs/mainnet/README.md` in compliance with `AGENTS.md`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma ORM, Ethers.js v6, Tailwind CSS, Node.js native test runner (`node:test`).

---

### Task 1: API Route for Commit Latency Telemetry
**Files:**
- Create: `src/app/api/admin/system/commit-latency/route.ts`
- Test: `src/lib/admin/__tests__/commit-latency.test.mjs`

**Step 1: Write the test for commit latency calculation & route response structure**
- Verify percentile calculations (P50, P95, Avg, Min, Max).
- Verify formatting and scoping requirements.

**Step 2: Implement `/api/admin/system/commit-latency/route.ts`**
- Guard with `requireAnyScope(request, ["engineering", "read"])`.
- Probe DB transaction commit latency via `prisma.$transaction`.
- Probe Arc RPC block write and read latency.
- Aggregate recent `VaultCommitIntent` metrics and duration statistics.
- Return structured telemetry JSON.

**Step 3: Run tests to verify they pass**
- Execute `node --test src/lib/admin/__tests__/commit-latency.test.mjs`
- Execute `node --test src/lib/admin/__tests__/capabilities-coverage.test.mjs`

---

### Task 2: Admin Dashboard Frontend Component
**Files:**
- Create: `src/components/admin/AdminCommitLatencyView.tsx`

**Step 1: Build the `AdminCommitLatencyView` component**
- Implement auto-refresh selector (off, 5s, 10s, 30s) and manual probe button.
- Render 4 KPI vitals cards (Database Commit Latency, Arc Block Write Latency, Vault Commit Escrow Latency, and Pipeline Finality).
- Render visual 4-phase commit latency breakdown bar (Preflight -> Custody -> Blockchain -> Mirror Sync).
- Render Recent Commits Table with status indicators, durations, txHash links, and timestamps.

---

### Task 3: Admin Navigation & Page Integration
**Files:**
- Modify: `src/app/admin/page.tsx`

**Step 1: Update navigation types and groups**
- Add `"commit-latency"` to `TabId`.
- Add `{ id: "commit-latency", label: "Commit Latency" }` to `TABS`.
- Add item under `system-group` in `adminNavGroups` with icon `Zap`.
- Mount `<AdminCommitLatencyView />` in the active tab switch.

---

### Task 4: Verification & Protocol Master Documentation
**Files:**
- Modify: `docs/mainnet/README.md`

**Step 1: Run full verification suite**
- Run `node --test src/lib/admin/__tests__/capabilities-coverage.test.mjs`
- Run TypeScript compile check `npx tsc --noEmit`
**Step 2: Update `docs/mainnet/README.md` Section 9.2**
- Log the implementation, metrics, and verification results per the Mainnet Documentation rule in `AGENTS.md`.
