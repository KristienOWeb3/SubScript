/**
 * Validation for a webhook endpoint's `enabled_events` subscription list.
 *
 * Why this exists: endpoint registration accepted `enabled_events` with no validation beyond
 * `Array.isArray`. An integrator who subscribed to `subscription.renewd` — a plausible typo —
 * got a 201, a working-looking endpoint row, and silence forever. Nothing in the product could
 * tell them the name matched no event, because the fan-out query simply found no match and
 * returned zero endpoints. The failure was indistinguishable from "the event never happened".
 *
 * Rules:
 * - Block comments only.
 * - The accepted grammar here MUST mirror the fan-out selector in recordMerchantEvent
 *   exactly. If this accepts a pattern the selector cannot match, we are back to silence
 *   with an extra step. See ENABLED_EVENT_MATCH_CONTRACT below.
 * - Reject on unknown names rather than dropping them: silently filtering an invalid entry
 *   is the same failure with better-looking storage.
 */

import { PUBLIC_EVENT_TYPES, isPublicEventType, isReservedEventType } from "./types";

/**
 * The contract this module is coupled to.
 *
 * recordMerchantEvent selects endpoints with:
 *   enabledEvents is empty
 *   OR enabledEvents hasSome [eventType, `${category}.*`, "*"]
 *
 * where `category` is the substring before the first dot. So exactly three shapes can ever
 * match: an exact public type, a `category.*` wildcard, and the global `*`. Anything else —
 * `subscription.*.renewed`, `sub*`, `SUBSCRIPTION.RENEWED` — is unmatchable, and must be
 * rejected at the door rather than stored.
 */
export const ENABLED_EVENT_MATCH_CONTRACT = "exact | category.* | *" as const;

/** Every category prefix that has at least one public event type. */
export const EVENT_CATEGORIES: readonly string[] = Array.from(
    new Set(PUBLIC_EVENT_TYPES.map((type) => type.split(".")[0])),
).sort();

const CATEGORY_SET = new Set(EVENT_CATEGORIES);

export type EnabledEventsValidation =
    | { ok: true; enabledEvents: string[] }
    | { ok: false; error: string };

/**
 * Suggest the closest legal subscription for a rejected entry.
 *
 * Cheap edit-distance over the public catalog. This is the whole point of the module: the
 * integrator who typed `subscription.renewd` should be told `subscription.renewed`, not handed
 * a 200-name enum to diff by eye.
 */
function nearestKnown(value: string): string | null {
    const candidates: readonly string[] = [
        ...PUBLIC_EVENT_TYPES,
        ...EVENT_CATEGORIES.map((category) => `${category}.*`),
    ];
    let best: string | null = null;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
        const distance = editDistance(value, candidate);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }

    /* Only suggest a near miss. Beyond a third of the length the "suggestion" is noise that
       reads as though the platform guessed wildly at what was meant. */
    const threshold = Math.max(2, Math.floor(value.length / 3));
    return bestDistance <= threshold ? best : null;
}

/* Iterative Levenshtein with a single rolling row. The candidate list is ~40 entries and this
   runs once per rejected subscription at registration time, so clarity beats cleverness. */
function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            const insertion = current[j - 1] + 1;
            const deletion = previous[j] + 1;
            current[j] = Math.min(substitution, insertion, deletion);
        }
        previous = current;
    }

    return previous[b.length];
}

/**
 * Validate and normalize a merchant-supplied subscription list.
 *
 * An empty list means "every event" — that is the existing fan-out behaviour and the default
 * for a new endpoint, so it stays legal and is not a rejection.
 */
export function validateEnabledEvents(raw: unknown): EnabledEventsValidation {
    if (raw === undefined || raw === null) {
        return { ok: true, enabledEvents: [] };
    }

    if (!Array.isArray(raw)) {
        return {
            ok: false,
            error: "enabled_events must be an array of event names. Omit it, or send [] to receive every event.",
        };
    }

    if (raw.length > 200) {
        return { ok: false, error: "enabled_events accepts at most 200 entries." };
    }

    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        if (typeof entry !== "string" || entry.trim() === "") {
            return { ok: false, error: "Every enabled_events entry must be a non-empty string." };
        }

        /* Lowercase is a normalization, not a guess: the catalog is entirely lowercase, so
           `Subscription.Renewed` has exactly one plausible meaning. Anything still unmatched
           after this is a genuine error rather than a casing difference. */
        const value = entry.trim().toLowerCase();

        if (seen.has(value)) continue;

        if (value === "*") {
            seen.add(value);
            normalized.push(value);
            continue;
        }

        if (value.endsWith(".*")) {
            const category = value.slice(0, -2);
            if (!CATEGORY_SET.has(category)) {
                return {
                    ok: false,
                    error: `Unknown event category '${category}' in enabled_events. `
                        + `Valid categories: ${EVENT_CATEGORIES.join(", ")}.`,
                };
            }
            seen.add(value);
            normalized.push(value);
            continue;
        }

        if (isPublicEventType(value)) {
            seen.add(value);
            normalized.push(value);
            continue;
        }

        /* A reserved type gets its own message. The name is real and an integrator may have
           found it in an older changelog or SDK build, so "unknown event" would be actively
           misleading — the accurate statement is that nothing emits it yet. */
        if (isReservedEventType(value)) {
            return {
                ok: false,
                error: `Event type '${value}' is reserved and not emitted yet, so subscribing to it `
                    + "would never deliver. Remove it and subscribe once it appears in the public catalog.",
            };
        }

        const suggestion = nearestKnown(value);
        return {
            ok: false,
            error: `Unknown event type '${value}' in enabled_events.`
                + (suggestion ? ` Did you mean '${suggestion}'?` : "")
                + ` Supported shapes: an exact event name, a category wildcard (${EVENT_CATEGORIES[0]}.*), or *.`,
        };
    }

    return { ok: true, enabledEvents: normalized };
}
