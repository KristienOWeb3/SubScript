# Load Testing SubScript

This project includes a dependency-free smoke load tester for local and staging checks:

```bash
npm run load:test -- --url http://127.0.0.1:3000/ --requests 1000 --concurrency 25
```

For a fixed-duration run:

```bash
npm run load:test -- --url https://www.subscriptonarc.com/ --duration 60 --concurrency 50 --rps 200
```

## How to Model 50 Million Users

Do not run 50 million requests from one machine. Treat "50 million users" as a capacity model:

1. Estimate daily active users, peak concurrent users, requests per user, and payment-conversion rate.
2. Split traffic into realistic paths: static pages, signup/login, payment link creation, hosted checkout, webhook delivery, receipt lookup, and dashboard reads.
3. Keep third-party providers protected: mock or sandbox Resend, RPC providers, Circle, Cloudflare, Redis, and Sentry during destructive or high-volume tests.
4. Run distributed tests from a load platform such as k6 Cloud, Artillery Cloud, Grafana Cloud, or AWS/GCP workers.
5. Watch CDN cache hit rate, Vercel function duration, database CPU, Redis latency, payment provider error rates, webhook retries, and Sentry transaction sampling.

## Launch Gates

- Static pages sustain expected peak traffic from the CDN.
- API routes reject abuse with rate limits before hitting paid providers.
- Database queries for users, payment links, checkout intents, and receipts have indexes for high-cardinality lookups.
- Webhook handlers are idempotent and can survive provider retries.
- Sentry sampling is configured so a spike does not create a monitoring bill spike.
- Backups, rollback, and incident alerts are verified before public launch.
