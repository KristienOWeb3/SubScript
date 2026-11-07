import test from "node:test";
import assert from "node:assert/strict";
import { calculateLatencyStats, getLatencyHealthTier } from "../commitLatency.ts";

test("calculateLatencyStats - handles empty sample set", () => {
  const stats = calculateLatencyStats([]);
  assert.equal(stats.sampleCount, 0);
  assert.equal(stats.averageMs, null);
  assert.equal(stats.p50Ms, null);
  assert.equal(stats.p95Ms, null);
  assert.equal(stats.minMs, null);
  assert.equal(stats.maxMs, null);
  assert.equal(stats.pendingCount, 0);
  assert.equal(stats.failedCount, 0);
  assert.equal(stats.confirmedCount, 0);
});

test("calculateLatencyStats - correctly aggregates completed and non-completed statuses", () => {
  const baseTime = 1700000000000;
  const samples = [
    { status: "PENDING", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 100) },
    { status: "FAILED", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 200) },
    { status: "SUBMITTED", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 800) },
    { status: "MIRRORED", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 1200) },
    { status: "MIRRORED", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 1000) },
  ];

  const stats = calculateLatencyStats(samples);
  assert.equal(stats.sampleCount, 3);
  assert.equal(stats.pendingCount, 1);
  assert.equal(stats.failedCount, 1);
  assert.equal(stats.confirmedCount, 3);
  assert.equal(stats.minMs, 800);
  assert.equal(stats.maxMs, 1200);
  assert.equal(stats.averageMs, 1000); // (800 + 1000 + 1200) / 3
  assert.equal(stats.p50Ms, 1000);
});

test("calculateLatencyStats - computes 95th percentile correctly", () => {
  const baseTime = 1700000000000;
  // 100 samples from 100ms to 10000ms
  const samples = Array.from({ length: 100 }, (_, i) => ({
    status: "MIRRORED",
    createdAt: new Date(baseTime),
    updatedAt: new Date(baseTime + (i + 1) * 100),
  }));

  const stats = calculateLatencyStats(samples);
  assert.equal(stats.sampleCount, 100);
  assert.equal(stats.minMs, 100);
  assert.equal(stats.maxMs, 10000);
  assert.equal(stats.p50Ms, 5100); // 50th index is element 51 (5100ms)
  assert.equal(stats.p95Ms, 9600); // 95th index is element 96 (9600ms)
});

test("getLatencyHealthTier - maps latency thresholds accurately", () => {
  assert.equal(getLatencyHealthTier(null), "unmeasured");
  assert.equal(getLatencyHealthTier(0), "unmeasured");
  assert.equal(getLatencyHealthTier(450), "optimal");
  assert.equal(getLatencyHealthTier(2499), "optimal");
  assert.equal(getLatencyHealthTier(2500), "acceptable");
  assert.equal(getLatencyHealthTier(4999), "acceptable");
  assert.equal(getLatencyHealthTier(5000), "degraded");
  assert.equal(getLatencyHealthTier(8500), "degraded");
});

test("calculateLatencyStats - handles single sample edge case", () => {
  const baseTime = 1700000000000;
  const samples = [
    { status: "MIRRORED", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 1500) },
  ];
  const stats = calculateLatencyStats(samples);
  assert.equal(stats.sampleCount, 1);
  assert.equal(stats.confirmedCount, 1);
  assert.equal(stats.averageMs, 1500);
  assert.equal(stats.p50Ms, 1500);
  assert.equal(stats.p95Ms, 1500);
  assert.equal(stats.minMs, 1500);
  assert.equal(stats.maxMs, 1500);
});

test("calculateLatencyStats - ignores negative duration (clock skew / inverted timestamps)", () => {
  const baseTime = 1700000000000;
  const samples = [
    { status: "MIRRORED", createdAt: new Date(baseTime + 5000), updatedAt: new Date(baseTime) },
  ];
  const stats = calculateLatencyStats(samples);
  assert.equal(stats.sampleCount, 0);
  assert.equal(stats.confirmedCount, 1);
  assert.equal(stats.averageMs, null);
  assert.equal(stats.p50Ms, null);
});

test("calculateLatencyStats - safely handles invalid or unparseable timestamps", () => {
  const samples = [
    { status: "SUBMITTED", createdAt: "invalid-date", updatedAt: "corrupted" },
  ];
  const stats = calculateLatencyStats(samples);
  assert.equal(stats.sampleCount, 0);
  assert.equal(stats.confirmedCount, 1);
  assert.equal(stats.averageMs, null);
});

test("calculateLatencyStats - normalizes status casing and handles out-of-order samples", () => {
  const baseTime = 1700000000000;
  const samples = [
    { status: "mirrored", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 3000) },
    { status: "Pending", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 500) },
    { status: "SUBMITTED", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 1000) },
    { status: "failed", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 200) },
    { status: "Submitted", createdAt: new Date(baseTime), updatedAt: new Date(baseTime + 2000) },
  ];
  const stats = calculateLatencyStats(samples);
  assert.equal(stats.sampleCount, 3);
  assert.equal(stats.confirmedCount, 3);
  assert.equal(stats.pendingCount, 1);
  assert.equal(stats.failedCount, 1);
  assert.equal(stats.minMs, 1000);
  assert.equal(stats.maxMs, 3000);
  assert.equal(stats.p50Ms, 2000);
  assert.equal(stats.averageMs, 2000);
});

