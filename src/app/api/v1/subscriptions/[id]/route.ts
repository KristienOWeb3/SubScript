/**
 * GET/DELETE /api/v1/subscriptions/{id}
 *
 * Retrieving one subscription used to mean listing all of them and filtering client-side: the only
 * single-read was `?id=`, and it rejected the `sub_<uuid>` ids the list actually returns. This route
 * gives subscriptions the same single-intent shape the rest of v1 has, and accepts both id spaces
 * through the shared resolver so it can never disagree with the collection route.
 *
 * Cancellation semantics are unchanged — the collection route's DELETE is the one implementation,
 * and this path delegates to it so `DELETE /{id}` and `DELETE ?id=` cannot drift.
 */

import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors";
import { authenticateMerchant, requireEnterpriseAndPremium } from "@/lib/v1/merchantAuth";
import { resolveApiSubscription } from "@/lib/subscriptions/apiSubscriptionResolve";
import { DELETE as deleteSubscription } from "../route";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress);
        if (!premiumCheck.ok) {
            return NextResponse.json({ error: premiumCheck.error }, { status: premiumCheck.status });
        }

        const { id } = await params;
        const resolved = await resolveApiSubscription({ merchantAddress: auth.merchantAddress, id });
        if (!resolved.ok) {
            return NextResponse.json({ error: resolved.error }, { status: resolved.status });
        }
        return NextResponse.json(resolved.subscription, { status: 200 });
    } catch (error: any) {
        console.error("Subscription GET error:", error);
        return apiError({
            status: 500,
            code: "internal_error",
            message: "Internal Server Error. Quote the request_id when reporting this.",
        });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    /* The collection handler reads the id from the query string, so the path id is forwarded there
       rather than duplicating the cancel rules (checkout withdrawal vs cancel-at-period-end, the
       DM notification, the webhook). */
    const url = new URL(request.url);
    url.pathname = "/api/v1/subscriptions";
    url.searchParams.set("id", id);
    return deleteSubscription(new Request(url, {
        method: "DELETE",
        headers: request.headers,
    }));
}
