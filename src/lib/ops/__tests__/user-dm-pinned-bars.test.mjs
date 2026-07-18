import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(
    new URL("../../../app/dashboard/user/page.tsx", import.meta.url),
    "utf8",
);

function elementWithTestId(testId) {
    const start = dashboard.indexOf(`data-testid="${testId}"`);
    assert.notEqual(start, -1, `expected ${testId} to exist`);
    return dashboard.slice(start, start + 500);
}

test("active mobile DMs lock the page and scroll only the message history", () => {
    assert.match(
        dashboard,
        /isActiveMobileDm \? "h-\[100dvh\] overflow-hidden" : "min-h-\[100dvh\]"/,
    );
    assert.match(
        dashboard,
        /min-h-0 flex-1 overflow-y-auto overscroll-contain[^"]*space-y-4[^"]*pb-4/,
    );

    const scroller = elementWithTestId("mobile-dm-message-scroller");
    assert.match(scroller, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);

    const footer = elementWithTestId("mobile-dm-action-footer");
    assert.match(footer, /shrink-0/);
    assert.match(footer, /border-t/);
    assert.doesNotMatch(footer, /\bfixed\b|\binset-x-0\b/);
});

test("desktop DM header and footer remain pinned around the message scroller", () => {
    const header = elementWithTestId("desktop-dm-header");
    const footer = elementWithTestId("desktop-dm-action-footer");

    assert.match(header, /sticky top-0/);
    assert.match(footer, /sticky bottom-0/);
    assert.match(dashboard, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
});

test("expanded DM actions scroll internally without moving the bottom controls", () => {
    assert.match(
        dashboard,
        /className="order-2 flex flex-wrap items-center gap-2 rounded-2xl/,
    );
    assert.match(
        dashboard,
        /className="order-1 max-h-\[min\(48dvh,28rem\)\][^"]*overflow-y-auto overscroll-contain/,
    );
    assert.match(
        dashboard,
        /max-h-\[min\(55dvh,30rem\)\] overflow-y-auto overscroll-contain/,
    );
});
