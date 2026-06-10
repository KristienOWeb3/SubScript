/* Strictly typed schemas for event-sourced Kafka backbone */

export interface KafkaEvent {
    eventId: string;
    entityId: string;
    entityType: "PAYMENT" | "PAYOUT" | "MERCHANT" | "LEDGER";
    eventType: string;
    correlationId: string;
    sequenceNumber: number;
    payload: any;
    createdAt: string;
}

export const Topics = {
    PAYMENT: "subscript.events.payment",
    PAYOUT: "subscript.events.payout",
    LEDGER: "subscript.events.ledger"
} as const;
