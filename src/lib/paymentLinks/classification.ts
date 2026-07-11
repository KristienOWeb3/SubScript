/* Single source of truth for "is this payment link a peer / user-to-user request?" (as opposed to
   a merchant checkout link). This exact predicate is what the hosted checkout (/pay isUserRequest),
   the embedded-pay route, and the DM classifier must ALL agree on — when they diverged (the DM
   classifier keyed off the creator's account role while /pay keyed off link metadata), a link that
   /pay showed a "Go to DMs" button for produced a PAYMENT_REQUEST DM, whose confirm bounced back to
   /pay, which showed "Go to DMs" again: an infinite loop. Keying every surface off the same link
   metadata keeps them consistent. */
export function isPeerRequestLink(link: {
    merchantNameSnapshot?: string | null;
    merchant_name_snapshot?: string | null;
    externalReference?: string | null;
    external_reference?: string | null;
}): boolean {
    const nameSnapshot = link.merchantNameSnapshot ?? link.merchant_name_snapshot ?? null;
    const externalReference = link.externalReference ?? link.external_reference ?? null;
    return nameSnapshot === "SubScript user request" ||
        (typeof externalReference === "string" &&
            (externalReference.startsWith("peer-request:") || externalReference.startsWith("dm-peer-request:")));
}
