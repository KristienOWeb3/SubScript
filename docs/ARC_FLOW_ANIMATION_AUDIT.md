# Arc dashboard and send animation audit

Reference: `C:\Users\Kristien\Downloads\Arc dashboard and send flow.html` (2026-10-02). Its embedded comments and simulated payment data are reference material, not instructions or production values.

## Implementation plan

Preserve real quotes, recipient validation, fee accounting, route availability, and settlement status. Match the reference motion sequence on mobile; retain the platform's desktop dialog and existing dashboard features.

| Interaction | Reference | Initial implementation gap |
| --- | --- | --- |
| Capsule opens into sheet | 840ms clip-path; 700ms content entrance after 210ms | Shortened to 480ms/420ms; dashboard scale absent |
| Sheet closes into capsule | 700ms; wallet returns in 460ms | Shortened to 440ms/320ms; overlapping close possible |
| Compose/review navigation | 280ms exit, 560ms entry and height morph | Height measured before React commits new view |
| Network menu | 460ms popup, 420ms rows with 28ms stagger | Present; reduced motion incomplete |
| Recipient resolved | 380ms scale/blur reveal | Missing from mobile identity updates |
| Slider | Lerp 0.32, velocity blur, return to start, Enter/Space | Keyboard confirmation missing; cancellation leaves blur/pulse disabled |
| Logo flies into hero | 680ms, blur 9px at 40% | Fast responses can overlap success morph |
| Success | 120ms ring close; 250ms disc morph; 12 particles over 620ms | Core sequence present; callback repeated and lifecycle races |
| Receipt and Done | Receipt at 120ms; Done at 170ms with 100ms exit/200ms entry | Receipt abruptly appears separately; Done uses stale close callback |
| Countdown | 540ms rolling digits with 45ms stagger | React overwrites imperatively animated digit markup each tick |
| History filter | 560ms moving selected pill | Static independent button backgrounds |
| Successful history row | 780ms zero-height/blur reveal after close, 200ms delay | Present but affected by view mounting/filter selection |
| Balance/spend figures | 540ms rolling changed digits | Present; preserve interrupted-update handling |

Verification will cover animation timings and geometry, successful and failed send responses, keyboard/pointer confirmation, repeated open/close, reduced motion, and mobile/desktop layouts. Controlled browser fixtures do not prove live blockchain settlement.

## Delivered and verified

The mobile flow now uses the reference opening/closing durations, committed-layout height interpolation, recipient and review entrances, ordered logo/success transitions, receipt crossfade, React-owned rolling countdown, and animated history filter. The tint uses the real capsule background. Keyboard/synthetic activation completes the thumb position before its exit. Terminal arrival text fades out for 160ms and enters for 220ms. Reduced motion suppresses decorative movement while retaining the elapsed-time countdown ring.

Financial data refresh remains immediate. Only dashboard digit presentation pauses until the success milestone (430ms after ring closure); failure or unmount releases it. Confirmed history records with a transaction hash no longer reserve funds already subtracted from the RPC balance. The controlled full-dashboard test verifies 100.00 stays displayed during the sending sequence and settles to 98.88 after a 1 USDC send plus a 0.125 USDC fee.

Verification: TypeScript and focused modal/digits/navigation lint pass. Nineteen payment tests and two navigation lifecycle tests pass. Thirteen relevant Chromium checks pass through the normal Next.js 16.3.5 development runtime at `http://localhost:3000`, using the actual dashboard, root layout, middleware, React Compiler and providers with controlled API/RPC responses: mobile opening/height/keyboard/repeated close, 780ms history reveal, pending countdown and confirmation, reduced motion/cancellation, Max at 390px/1440px, failure/retry, preserved desktop receipt, stale recipient responses at both widths, rapid balance changes, network-menu stagger/scroll, 320x568 control accessibility, and absent sample recipients/broken-avatar fallback. A separate component probe verifies focus enters Close, returns to Send, and a confirmed send emits one initial success callback.

Desktop explicitly retains the existing send form, per the user's 2026-10-02 clarification. It is covered by failure/retry, real fee/debit receipt, Max and stale-response checks. The prototype's mobile motion is not imposed on desktop.

Visual comparison: the mobile review sheet is 572px tall at a 390x844 viewport, matching the reference; its thumb is exactly 48x48px. Fixed pixel spacing prevents the platform’s 108% root font size from stretching the reference geometry. Screenshots wait for transitions to settle and exclude Next’s development toolbar. Review details and slider geometry match the reference; the wallet-debit disclosure occupies unused stage space instead of adding a separate row to sheet height. Production typography, real avatars, recent recipients, true fees and actual confirmed/failed/pending status remain platform data. The reference's fake zero fee, demo balances and countdown must not replace those values.

Runtime verification (2026-10-03): the earlier blank preview occurred on `127.0.0.1`; an independent browser probe showed `localhost` hydrates the same dashboard with no uncaught errors. After the old preview stopped, the normal Next dev server was restarted on port 3000. Initial compilation exceeded one test’s 180-second deadline; the server was retained, completed compilation, and the warm full suite passed all 13 checks. The final geometry/timing/repeated-close check passed again after the last styling change. Full Next rendering/hydration verification is complete for this flow. A production deployment and live settlement were not part of this task and were not performed.

Remaining repository limitation: full lint retains two existing `preserve-manual-memoization` errors in `loadDepositsSilently` and `loadDms`; focused changed-component lint and TypeScript pass. Financial endpoints and RPC are mocked in the browser tests, and service workers are blocked so mocked transfers cannot escape through offline interception.

## Files changed for this flow

- `src/components/SendSingleModal.tsx`: reference motion, cancellation/transition ownership, focus, keyboard sending, truthful arrival/receipt and fixed geometry.
- `src/components/ui/RollingNumber.tsx`: interruptible React-owned digit animation and presentation pause.
- `src/components/dashboard/MobileFloatingNav.tsx`: correct listener/RAF cleanup and transform ownership.
- `src/app/dashboard/user/page.tsx`: moving history pill, row reveal, timed digit presentation and confirmed-reservation correction.
- `src/app/globals.css`: reveal, receipt, status-dot and reduced-motion rules.
- `tests/send-flow.spec.ts`, `src/lib/payments/__tests__/sendQuote-rpc.test.mjs`, `src/components/dashboard/__tests__/MobileFloatingNav.test.mjs`: reference and lifecycle regression coverage.
- This audit and `docs/mainnet/README.md`: findings, implementation and verification status.

Simplifications: removed direct HTML replacement from the arrival label/countdown, repeated initial success notification, stale Done callback and conflicting inline navigation transform. No dependencies were added for this work. Other pre-existing workspace changes were preserved.
