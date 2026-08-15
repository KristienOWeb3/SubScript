/* Admin database access is deliberately serialized.
 *
 * Production uses Supabase's transaction pooler with connection_limit=1. A large Promise.all
 * therefore creates a queue of Prisma queries that can outlive Prisma's 10s pool timeout and
 * turn a read-only admin screen into a 500. Keeping the queue inside one request explicit also
 * makes transient P2024 errors retryable without duplicating route logic.
 */

const RETRYABLE_CODES = new Set(["P2024", "P1001", "P1002"]);

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return RETRYABLE_CODES.has(code)
    || /connection pool|timed out fetching a new connection|can't reach database/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withAdminDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 1 || !isRetryable(error)) throw error;
      await wait(200 * Math.pow(2, attempt));
    }
  }
}

export async function runAdminQueriesSequentially<const T extends readonly unknown[]>(
  queries: { readonly [K in keyof T]: () => Promise<T[K]> },
): Promise<T> {
  const results: unknown[] = [];
  for (const query of queries as readonly (() => Promise<unknown>)[]) {
    results.push(await withAdminDbRetry(query));
  }
  return results as unknown as T;
}
