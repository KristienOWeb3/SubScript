/* Chart data colours for the admin console.
 *
 * These are the colours that ENCODE DATA — a series, a status, an axis. Card chrome (borders,
 * surfaces, body ink) is not in here and should keep using the literals it already uses; mixing
 * the two is how "which blue is the data one" gets lost.
 *
 * Every value below was measured with a colour-distance validator against the white chart surface
 * rather than picked by eye, because the failures here are not the kind you can see by looking. The
 * clearest example: #a21caf (fuchsia) looks obviously different from #2775ca to full-colour vision
 * and measures ΔE 22.9 — but only 4.7 under deuteranopia, meaning a red-green colourblind reader
 * sees one colour where we drew two. It was rejected on that number alone. The measurements that
 * decided each slot are recorded per-slot so nobody re-introduces a rejected hue on the grounds
 * that it looked fine.
 *
 * ΔE figures are OKLab ×100. The target for a pair a reader must separate is ≥ 8 under simulated
 * CVD; 6–8 is a floor that only holds when something OTHER than colour also distinguishes the two
 * marks; and a normal-vision figure below 15 is a hard fail regardless.
 *
 * If you add a slot, re-run the validator over the whole set with `--pairs all`, not just adjacent
 * pairs. A donut is a ring, so its first and last slice touch — sequential-only checking misses it.
 */

/* Categorical: identity, where the colour says WHICH THING and nothing more. Assign in this order
 * and never cycle — a fourth series is not a generated hue, it folds into "Other" or the chart
 * becomes small multiples.
 *
 * Ordered blue → magenta → lime, and the order is load-bearing: worst all-pairs separation is
 * #4d7c0f ↔ #be185d at ΔE 6.8 deutan / 7.7 tritan, with normal vision at 25.7. That sits in the
 * 6–8 band, so these three are only legal together BECAUSE every chart using them also labels its
 * marks directly — the donut legend carries label, value and percent per row, there is a text table
 * behind every chart, and a 2px surface gap separates adjacent arcs. If you ever use this ring
 * WITHOUT direct labels, it stops being compliant and you need to cut to two series or facet.
 *
 * Rejected for this slot, with the numbers: #a21caf fuchsia (ΔE 4.7 deutan vs blue — invisible
 * split); #0e7490 dark cyan (chroma 0.094, reads grey, and only ΔE 9.4 from blue in NORMAL vision);
 * #c2410c orange, which measured beautifully (26.1 protan, 31.5 tritan) but is the warning hue —
 * a series in warning-orange makes a reader ask whether the third slice is an alert.
 */
export const CHART_CATEGORICAL = ["#2775ca", "#be185d", "#4d7c0f"] as const;

/* The two-series case — the area charts' primary and secondary line. Derived from the ring rather
 * than restated, so the first two categorical slots and "the two series" can never drift apart.
 *
 * secondary was #00d2b4 (the merchant dashboard's teal) and then briefly #0d9488: both were wrong
 * here. #00d2b4 measured 1.88:1 against white, well under the 3:1 a data mark needs. #0d9488 fixed
 * the contrast but separated from #2775ca by only ΔE 4.7 under tritanopia — the two lines collapsed
 * into one colour for a blue-yellow colourblind reader. #be185d measures 18.7 deutan / 31.7 tritan
 * / 29.1 normal against the primary, so it holds up on every channel instead of just the common one.
 *
 * The area chart additionally draws the secondary line dashed and the primary solid, so identity
 * survives even a greyscale print. That is deliberate belt-and-braces, not a reason to relax the
 * colour requirement.
 */
export const CHART_SERIES = {
    primary: CHART_CATEGORICAL[0],
    secondary: CHART_CATEGORICAL[1],
} as const;

/* Status slots: KYC decision states, subscription billing states, gas-relayer health.
 *
 * Reserved for state and never reused as "series 4" — if good/warning/critical also mean "the third
 * category", a reader can no longer tell whether amber is a warning or just the next colour along.
 * This is why the categorical ring above avoids orange and violet even where they measured well.
 * Status is also never colour ALONE: every use pairs these with a text label or a badge.
 *
 * warning and critical replace #f59e0b and #ef4444, which measured ΔE 14.4 apart in normal vision
 * against a floor of 15 — amber and red sitting adjacent in a status ring were genuinely hard to
 * separate, and `SubscriptionsView` put "Cancelling" directly beside "Past due" using exactly that
 * pair. Re-stepping to a yellower amber and a darker red takes it to 17.4 deutan / 20.5 normal.
 *
 * good replaces #10b981, which was 2.47:1 against white and only ΔE 8.6 from #00d2b4 — so "active
 * subscriptions" and "trialing" were near-identical greens in the same ring.
 *
 * warning is 2.86:1, just under the 3:1 mark floor. That is a deliberate, bounded exception, and it
 * carries a standing obligation: anything painted with it also needs a visible text label or a table
 * view. Do not use it for an unlabelled mark.
 *
 * inactive is intentionally a low-chroma slate — "ended / expired / revoked" should recede rather
 * than compete with live states for attention. It reads as grey by design, so it is exempt from the
 * chroma floor, and it must never be the only difference between two segments that both matter.
 */
export const CHART_STATUS = {
    good: "#059669",
    info: "#2775ca",
    warning: "#ca8a04",
    critical: "#b91c1c",
    paused: "#6d28d9",
    inactive: "#64748b",
} as const;

/* Chart furniture. Grid and baseline are meant to recede behind the data; axis text is not.
 *
 * axisText replaces #94a3b8, which is 2.8:1 against white and fails WCAG AA for text. It was being
 * used at 8–9px, the size where contrast matters most, so it was the least readable text in the
 * console rather than merely a quiet one. #64748b measures 4.7:1 and clears AA.
 */
export const CHART_INK = {
    axisText: "#64748b",
    gridLine: "#f1f5f9",
    baseline: "#e2e8f0",
} as const;
