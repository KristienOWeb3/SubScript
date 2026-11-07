export interface IntentTimingSample {
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface LatencyStats {
  sampleCount: number;
  averageMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  pendingCount: number;
  failedCount: number;
  confirmedCount: number;
}

/**
 * Calculates latency distribution metrics across vault commit intents.
 * Considers SUBMITTED and MIRRORED states as completed executions.
 */
export function calculateLatencyStats(samples: IntentTimingSample[]): LatencyStats {
  let pendingCount = 0;
  let failedCount = 0;
  let confirmedCount = 0;
  const durations: number[] = [];

  for (const s of samples) {
    const status = s.status?.toUpperCase();
    if (status === "PENDING") {
      pendingCount++;
    } else if (status === "FAILED") {
      failedCount++;
    } else if (status === "SUBMITTED" || status === "MIRRORED") {
      confirmedCount++;
      const created = new Date(s.createdAt).getTime();
      const updated = new Date(s.updatedAt).getTime();
      if (!isNaN(created) && !isNaN(updated) && updated >= created) {
        durations.push(updated - created);
      }
    }
  }

  durations.sort((a, b) => a - b);

  if (durations.length === 0) {
    return {
      sampleCount: 0,
      averageMs: null,
      p50Ms: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
      pendingCount,
      failedCount,
      confirmedCount,
    };
  }

  const sum = durations.reduce((acc, val) => acc + val, 0);
  const averageMs = Math.round(sum / durations.length);
  const minMs = durations[0];
  const maxMs = durations[durations.length - 1];

  const p50Index = Math.floor(durations.length * 0.5);
  const p50Ms = durations[p50Index];

  const p95Index = Math.min(
    durations.length - 1,
    Math.floor(durations.length * 0.95)
  );
  const p95Ms = durations[p95Index];

  return {
    sampleCount: durations.length,
    averageMs,
    p50Ms,
    p95Ms,
    minMs,
    maxMs,
    pendingCount,
    failedCount,
    confirmedCount,
  };
}

/**
 * Evaluates health status based on measured latencies in milliseconds.
 */
export function getLatencyHealthTier(ms: number | null): "optimal" | "acceptable" | "degraded" | "unmeasured" {
  if (ms === null || ms <= 0) return "unmeasured";
  if (ms < 2500) return "optimal";
  if (ms < 5000) return "acceptable";
  return "degraded";
}
