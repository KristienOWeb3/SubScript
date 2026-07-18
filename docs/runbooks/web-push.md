# Browser Web Push runbook

SubScript uses standards-based Web Push with VAPID. The browser owns its push subscription;
SubScript stores only the delivery endpoint and public encryption material. The VAPID private key
must remain server-side.

## Required environment variables

Configure the same key pair in every environment where push should work:

| Variable | Visibility | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Browser-safe | Creates browser push subscriptions |
| `VAPID_PUBLIC_KEY` | Server | Must equal the browser public key |
| `VAPID_PRIVATE_KEY` | Server secret | Signs Web Push requests; never use a `NEXT_PUBLIC_` prefix |
| `VAPID_SUBJECT` | Server | Contact URI such as `mailto:support@subscriptonarc.com` |

Generate a new pair with `npx web-push generate-vapid-keys`. Keep one pair stable per environment:
changing it invalidates subscriptions created with the old public key.

For Vercel, add all four variables to the intended Production, Preview, or Development scope and
redeploy. A value in `.env.local` activates local development only.

## Activation test

1. Sign in and open **Account → Notifications**.
2. Turn on **Browser Push (This Device)** and accept the browser permission prompt.
3. Click **Send test**.
4. Confirm the notification appears and opens the user dashboard.

The test endpoint is authenticated and targets only subscriptions associated with the current
wallet. It returns a clear error when VAPID is missing, storage is unavailable, no device is
registered, or delivery fails.

## Data and security model

- `public.push_subscriptions` has RLS enabled with an explicit deny-all policy.
- Only the server-side Supabase service client reads and writes subscriptions.
- Subscription endpoints must be HTTPS, cannot contain credentials or custom ports, and cannot
  target loopback, link-local, or private literal IP addresses.
- Expired endpoints returning `404` or `410` are deleted automatically.
- Navigations and API responses are never service-worker cached; only the offline fallback and
  static icons are cached.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| “Push notifications aren't configured yet” | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` was present at build time; redeploy after adding it |
| Server configuration error | Both server keys exist, match, and `VAPID_SUBJECT` starts with `mailto:` or `https:` |
| No registered device | Permission is granted and the subscribe request returned `201` |
| Delivery fails after key rotation | Disable and re-enable Browser Push to create a subscription using the new public key |
| Works locally but not on Vercel | The four variables exist in the correct Vercel environment scope |
| iOS does not prompt | Install the PWA to the Home Screen first; iOS Web Push requires an installed web app |

Run `npm run test:push` after changing the subscription route, VAPID handling, service worker, or
notification settings UI.
