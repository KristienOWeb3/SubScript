const PAYMENT_LINK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidPaymentLinkId(id: string): boolean {
    return PAYMENT_LINK_ID_PATTERN.test(id);
}
