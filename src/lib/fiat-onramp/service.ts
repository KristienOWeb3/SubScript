import { Prisma, type FiatFundingIntent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FiatOnrampConfig } from "./config";
import { requireSandboxConfig } from "./config";
import { assertAmountWithinBounds, calculateQuote } from "./money";
import { badRequest, conflict, notFound } from "./errors";
import {
    decideSimulation,
    deterministicSimulationEventId,
    FUNDING_STATUS,
    resolveIdempotentCreate,
} from "./state";

const SANDBOX_PROVIDER = "SUBSCRIPT_SANDBOX";
const SANDBOX_BANK_NAME = "SUBSCRIPT SANDBOX BANK — DO NOT TRANSFER";
const SANDBOX_ACCOUNT_NAME = "SUBSCRIPT TEST ONLY — NO REAL FUNDS";
const SANDBOX_ACCOUNT_NUMBER = "0000000000";

function isUniqueConstraintError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeIdempotencyKey(value: string | null) {
    const key = value?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
        throw badRequest(
            "Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen",
            "INVALID_IDEMPOTENCY_KEY",
        );
    }
    return key;
}

async function findReplay(
    walletAddress: string,
    idempotencyKey: string,
    fiatAmountMinor: bigint,
) {
    const existing = await prisma.fiatFundingIntent.findFirst({
        where: { walletAddress, idempotencyKey },
    });
    if (!existing) return null;
    resolveIdempotentCreate(existing.fiatAmountMinor, fiatAmountMinor);
    return existing;
}

async function findActiveIntent(walletAddress: string, now: Date) {
    return prisma.fiatFundingIntent.findFirst({
        where: {
            walletAddress,
            status: FUNDING_STATUS.AWAITING_TRANSFER,
            expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function createFundingIntent(input: {
    walletAddress: string;
    amountMinor: bigint;
    idempotencyKey: string | null;
    config: FiatOnrampConfig;
    now?: Date;
}): Promise<{ intent: FiatFundingIntent; created: boolean }> {
    const config = requireSandboxConfig(input.config);
    const walletAddress = input.walletAddress.toLowerCase();
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const now = input.now || new Date();

    await expireAwaitingIntents(walletAddress, now);

    assertAmountWithinBounds(
        input.amountMinor,
        config.minimumFiatMinor,
        config.maximumFiatMinor,
    );

    const replay = await findReplay(walletAddress, idempotencyKey, input.amountMinor);
    if (replay) return { intent: replay, created: false };

    const activeIntent = await findActiveIntent(walletAddress, now);
    if (activeIntent) {
        throw conflict(
            "A bank-transfer funding intent is already awaiting transfer",
            "ACTIVE_FUNDING_INTENT_EXISTS",
        );
    }

    const quote = calculateQuote(
        input.amountMinor,
        config.quoteRateNgnPerUsdcMinor,
        BigInt(0),
    );
    const uniqueId = crypto.randomUUID();

    try {
        const intent = await prisma.fiatFundingIntent.create({
            data: {
                walletAddress,
                destinationWallet: walletAddress,
                idempotencyKey,
                provider: SANDBOX_PROVIDER,
                providerReference: `sandbox:${uniqueId}`,
                fiatCurrency: "NGN",
                fiatAmountMinor: input.amountMinor,
                quoteRateNgnPerUsdcMinor: config.quoteRateNgnPerUsdcMinor,
                grossUsdcMicros: quote.grossUsdcMicros,
                feeFiatMinor: quote.feeFiatMinor,
                netUsdcMicros: quote.netUsdcMicros,
                status: FUNDING_STATUS.AWAITING_TRANSFER,
                bankName: SANDBOX_BANK_NAME,
                accountName: SANDBOX_ACCOUNT_NAME,
                accountNumber: SANDBOX_ACCOUNT_NUMBER,
                transferReference: `SBX-${uniqueId.toUpperCase()}`,
                destinationChainId: config.chainId,
                expiresAt: new Date(now.getTime() + config.quoteTtlSeconds * 1000),
            },
        });
        return { intent, created: true };
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        const concurrentReplay = await findReplay(
            walletAddress,
            idempotencyKey,
            input.amountMinor,
        );
        if (concurrentReplay) return { intent: concurrentReplay, created: false };

        const concurrentActiveIntent = await findActiveIntent(walletAddress, now);
        if (concurrentActiveIntent) {
            throw conflict(
                "A bank-transfer funding intent is already awaiting transfer",
                "ACTIVE_FUNDING_INTENT_EXISTS",
            );
        }
        throw error;
    }
}

async function expireAwaitingIntents(walletAddress: string, now: Date, id?: string) {
    await prisma.fiatFundingIntent.updateMany({
        where: {
            ...(id ? { id } : {}),
            walletAddress,
            status: FUNDING_STATUS.AWAITING_TRANSFER,
            expiresAt: { lte: now },
        },
        data: { status: FUNDING_STATUS.EXPIRED },
    });
}

export async function listFundingIntents(wallet: string, now = new Date()) {
    const walletAddress = wallet.toLowerCase();
    await expireAwaitingIntents(walletAddress, now);
    return prisma.fiatFundingIntent.findMany({
        where: { walletAddress },
        orderBy: { createdAt: "desc" },
        take: 20,
    });
}

export async function getFundingIntent(wallet: string, id: string, now = new Date()) {
    const walletAddress = wallet.toLowerCase();
    await expireAwaitingIntents(walletAddress, now, id);
    const intent = await prisma.fiatFundingIntent.findFirst({
        where: { id, walletAddress },
    });
    if (!intent) throw notFound();
    return intent;
}

export async function simulateFundingIntent(input: {
    walletAddress: string;
    id: string;
    config: FiatOnrampConfig;
    now?: Date;
}) {
    requireSandboxConfig(input.config);
    const walletAddress = input.walletAddress.toLowerCase();
    const now = input.now || new Date();

    await expireAwaitingIntents(walletAddress, now, input.id);

    try {
        return await prisma.$transaction(async (tx) => {
            const intent = await tx.fiatFundingIntent.findFirst({
                where: { id: input.id, walletAddress },
            });
            if (!intent) throw notFound();

            const decision = decideSimulation(intent.status, intent.expiresAt, now);
            if (decision === "replay") return intent;

            const transition = await tx.fiatFundingIntent.updateMany({
                where: {
                    id: intent.id,
                    walletAddress,
                    status: FUNDING_STATUS.AWAITING_TRANSFER,
                    expiresAt: { gt: now },
                },
                data: {
                    status: FUNDING_STATUS.SIMULATED_SETTLED,
                    receivedAt: now,
                    settledAt: now,
                    settlementTxHash: null,
                },
            });

            if (transition.count === 1) {
                await tx.fiatFundingEvent.create({
                    data: {
                        fundingIntentId: intent.id,
                        providerEventId: deterministicSimulationEventId(intent.id),
                        eventType: "SANDBOX_TRANSFER_SIMULATED",
                        payload: {
                            sandbox: true,
                            realFundsMoved: false,
                            fiatAmountMinor: intent.fiatAmountMinor.toString(),
                            netUsdcMicros: intent.netUsdcMicros.toString(),
                        },
                        processingResult: "SIMULATED_SETTLED",
                        processedAt: now,
                    },
                });
            }

            const settled = await tx.fiatFundingIntent.findFirst({
                where: { id: intent.id, walletAddress },
            });
            if (!settled) throw notFound();
            if (settled.status !== FUNDING_STATUS.SIMULATED_SETTLED) {
                throw conflict(
                    "Funding intent transition was superseded; retry the request",
                    "STATE_TRANSITION_CONFLICT",
                );
            }
            return settled;
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        const settled = await prisma.fiatFundingIntent.findFirst({
            where: {
                id: input.id,
                walletAddress,
                status: FUNDING_STATUS.SIMULATED_SETTLED,
            },
        });
        if (settled) return settled;
        throw error;
    }
}
