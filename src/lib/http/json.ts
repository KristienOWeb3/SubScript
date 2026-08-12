import { NextResponse } from "next/server";

/* BigInt-safe JSON responses.
 *
 * WHY THIS EXISTS. Every money column in this schema is `BigInt` micro-USDC (6 dp), and
 * `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` rather than
 * degrading. A route that hands a raw Prisma row to `NextResponse.json` therefore 500s the
 * moment that model contains a money column — which is what broke merchant verification:
 * the row it echoed back carried available_balance_usdc, so a successful database write was
 * reported to the operator as a server error. The write had already committed, so the UI
 * showed a failure for something that worked, and a retry looked like it failed again.
 *
 * The fix is a serializer, not a set of remembered call sites. `jsonOk` walks the whole tree
 * via a `JSON.stringify` replacer, so a BigInt at ANY depth — nested include, array element,
 * JSON audit-detail column — is converted rather than thrown on. New routes get this for
 * free instead of having to know which columns are BigInt.
 *
 * UNITS ARE NOT GUESSED. A BigInt becomes its exact decimal string ("2500000"), never a
 * Number (loses integer precision past 2^53) and never a scaled decimal ("2.50"). Only the
 * call site knows whether a value is micro-USDC, a chain id, a block number, or a period in
 * seconds, so unit formatting stays there — see formatUsdc in api/admin/analytics.
 *
 * Dates need no special handling: `JSON.stringify` calls `Date.prototype.toJSON` before the
 * replacer sees the value, so they arrive as ISO strings already.
 */

if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
    (BigInt.prototype as any).toJSON = function () {
        return this.toString();
    };
}

function bigintReplacer(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Drop-in replacement for `NextResponse.json` that cannot throw on BigInt.
 *
 * Prefer this in any handler that touches Prisma. Reach for `NextResponse.json` only for
 * hand-built literals you can see contain no database values.
 */
export function jsonOk(data: unknown, init?: ResponseInit): NextResponse {
    const body = JSON.stringify(data, bigintReplacer);
    return new NextResponse(body, {
        ...init,
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...(init?.headers ?? {}),
        },
    });
}

/**
 * Plain-object form, for the rare caller that needs the converted value itself rather than a
 * response — assembling a webhook payload, or asserting on shape in a test.
 */
export function jsonSafe<T>(data: T): unknown {
    return JSON.parse(JSON.stringify(data, bigintReplacer));
}

/**
 * True when `JSON.stringify` would throw on this value.
 *
 * Exists for the regression test that walks every admin route's response shape; a plain
 * try/catch at each assertion site would not report *which* field is at fault.
 */
export function findUnserializable(value: unknown, path = "$"): string | null {
    if (typeof value === "bigint") return path;
    if (value === null || typeof value !== "object") return null;
    if (value instanceof Date) return null;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
            const found = findUnserializable(value[i], `${path}[${i}]`);
            if (found) return found;
        }
        return null;
    }
    for (const [key, child] of Object.entries(value)) {
        const found = findUnserializable(child, `${path}.${key}`);
        if (found) return found;
    }
    return null;
}
