#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const defaults = {
  url: "http://127.0.0.1:3000/",
  requests: 100,
  concurrency: 10,
  duration: 0,
  rps: 0,
  method: "GET",
};

function parseArgs(argv) {
  const options = { ...defaults };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--url" && next) {
      options.url = next;
      index += 1;
    } else if (arg === "--requests" && next) {
      options.requests = Number(next);
      index += 1;
    } else if (arg === "--concurrency" && next) {
      options.concurrency = Number(next);
      index += 1;
    } else if (arg === "--duration" && next) {
      options.duration = Number(next);
      index += 1;
    } else if (arg === "--rps" && next) {
      options.rps = Number(next);
      index += 1;
    } else if (arg === "--method" && next) {
      options.method = next.toUpperCase();
      index += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  for (const field of ["requests", "concurrency", "duration", "rps"]) {
    if (!Number.isFinite(options[field]) || options[field] < 0) {
      throw new Error(`Invalid --${field} value`);
    }
  }

  if (options.concurrency < 1) {
    throw new Error("--concurrency must be at least 1");
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run load:test -- --url http://127.0.0.1:3000/ --requests 1000 --concurrency 25

Options:
  --url          Target URL. Default: ${defaults.url}
  --requests     Total requests for a fixed-size run. Default: ${defaults.requests}
  --duration     Seconds to run. When set, duration controls the stop condition.
  --concurrency  Concurrent workers. Default: ${defaults.concurrency}
  --rps          Optional global request-per-second cap.
  --method       HTTP method. Default: GET
`);
}

function percentile(values, point) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.ceil((point / 100) * values.length) - 1;
  return values[Math.min(Math.max(index, 0), values.length - 1)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv);
  const startedAt = performance.now();
  const deadline = options.duration > 0 ? startedAt + options.duration * 1000 : Infinity;
  const latencies = [];
  const statuses = new Map();
  const errors = [];
  let launched = 0;
  let completed = 0;
  let nextLaunchAt = startedAt;

  async function worker() {
    while (performance.now() < deadline && (options.duration > 0 || launched < options.requests)) {
      if (options.rps > 0) {
        const now = performance.now();
        const delay = Math.max(0, nextLaunchAt - now);
        nextLaunchAt = Math.max(nextLaunchAt, now) + 1000 / options.rps;
        if (delay > 0) {
          await sleep(delay);
        }
      }

      const requestNumber = launched + 1;
      launched = requestNumber;
      const requestStartedAt = performance.now();

      try {
        const response = await fetch(options.url, {
          method: options.method,
          redirect: "manual",
        });
        const durationMs = performance.now() - requestStartedAt;
        latencies.push(durationMs);
        statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
        await response.arrayBuffer();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        completed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));

  latencies.sort((a, b) => a - b);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const statusObject = Object.fromEntries([...statuses.entries()].sort(([a], [b]) => a - b));

  console.log(
    JSON.stringify(
      {
        url: options.url,
        method: options.method,
        launched,
        completed,
        elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
        requestsPerSecond: Number((completed / elapsedSeconds).toFixed(2)),
        statusCounts: statusObject,
        errors: errors.length,
        firstErrors: errors.slice(0, 5),
        latencyMs: {
          min: Number((latencies[0] || 0).toFixed(2)),
          p50: Number(percentile(latencies, 50).toFixed(2)),
          p95: Number(percentile(latencies, 95).toFixed(2)),
          p99: Number(percentile(latencies, 99).toFixed(2)),
          max: Number((latencies[latencies.length - 1] || 0).toFixed(2)),
        },
      },
      null,
      2,
    ),
  );

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
