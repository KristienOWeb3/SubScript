# Mobile notification audit — 2026-10-12

Audited the user dashboard notification bell, notification preferences, browser push lifecycle, notification API, and broadcast delivery. All findings below have local fixes and regression coverage.

| Finding | Resolution |
| --- | --- |
| Mobile taps use a ref pointing to the hidden desktop panel, closing the panel before the row action completes | One responsive panel and content tree; pointer events check the visible panel |
| Closing after reading one item zeros the badge despite remaining unread items | Preserve unread count; wait for read receipts before cleanup |
| Failed reads/deletions silently lose local state or prevent retries | Restore affected rows/counts, show errors, release request guards |
| Polling can overwrite optimistic reads or discard older loaded pages | Cancel stale requests during mutations; retain paginated rows on refresh |
| Off-screen bridge notices are treated as viewed | Observe actual row visibility before transient cleanup |
| Long text and small controls make mobile use unreliable | Wrap long content; 44px bell, close, and preference switch targets; focus return on Escape |
| Preference load/save failures leave empty views or allow overlapping saves | Visible error/retry, serialized saves, accessible switch names and state |
| Failed push registration/unsubscribe can display false enabled/disabled status | Roll back new subscriptions on registration failure; check server and browser removal results |
| Supabase subscription deletion errors are returned as success | Check returned database errors and return failure |
| Concurrent lazy delivery/admin fan-out creates duplicate broadcast rows | Shared deterministic notification IDs for wallet, audience, and broadcast |
| Only the first 20 stored notifications are reachable | Validated timestamp/ID cursor pagination and Load more action |

Changed source: `src/components/dashboard/NotificationBell.tsx`, notification settings/handlers in `src/app/dashboard/user/page.tsx`, `src/lib/clientPush.ts`, `src/lib/notifications/broadcastId.ts`, and the notification, push subscription, and admin broadcast routes. Added bell, preference, and delivery runtime tests; updated the PIN notification mock for the shared ID helper.

Verification: 13 bell browser regressions and 3 preference browser regressions passed; 49 runtime/content/push/PIN notification checks passed. Full TypeScript passes. Repository ESLint passes with zero errors. Responsive browser coverage includes 320×568, 390×844, 667×375, and 1280×800; visual reviews are requirements-based because no reference image was supplied.

Limits: existing duplicate database rows were preserved. Lazy historical broadcast catch-up retains its existing latest-20-broadcast policy; pagination covers persisted notifications. Physical mobile Web Push delivery was not tested. The authenticated localhost session check became unavailable during inspection, so regression browser tests used intercepted APIs and actual application components. No live account preference, subscription, notification, database schema, or deployment was changed by this audit.
