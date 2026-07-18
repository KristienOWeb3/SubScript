const RECURRING_ONLY_FIELDS = [
    "interval",
    "intervalSeconds",
    "intervalCount",
    "periodDays",
    "planId",
    "publishToDm",
    "subscriber",
    "merchantCustomerId",
    "minCommitmentDays",
] as const;

const RECURRING_TEXT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
    {
        label: "recurring billing language",
        pattern: /\b(subscription|subscribe|subscriber|recurring|auto[\s-]?renew|renewal|membership)\b/i,
    },
    {
        label: "named billing cadence",
        pattern: /\b(daily|weekly|monthly|quarterly|yearly|annually)\b/i,
    },
    {
        label: "billing-period language",
        pattern: /\b(per|every)\s+(?:\d+\s+)?(?:day|week|month|quarter|year)s?\b/i,
    },
    {
        label: "duration-like product title",
        pattern: /(?:^|[\s—–-])\d+\s*(?:day|week|month|quarter|year)s?\b/i,
    },
    {
        label: "named product plan",
        pattern: /\b(?:starter|basic|standard|pro|professional|premium|business|enterprise)\s+plan\b/i,
    },
];

export type PaymentIntentSemanticCheck = {
    recurringFields: string[];
    recurringTextSignals: string[];
};

/**
 * `/api/intent` is deliberately one-time. This check catches payloads that an agent likely
 * intended to send to `/api/v1/plans` or `/api/v1/subscriptions` before financial records are
 * created with missing recurrence metadata.
 */
export function inspectPaymentIntentSemantics(body: Record<string, unknown>): PaymentIntentSemanticCheck {
    const recurringFields = RECURRING_ONLY_FIELDS.filter((field) =>
        body[field] !== undefined && body[field] !== null && body[field] !== ""
    );
    const productText = [body.title, body.description]
        .filter((value): value is string => typeof value === "string")
        .join(" ");
    const recurringTextSignals = RECURRING_TEXT_PATTERNS
        .filter(({ pattern }) => pattern.test(productText))
        .map(({ label }) => label);

    return { recurringFields: [...recurringFields], recurringTextSignals };
}
