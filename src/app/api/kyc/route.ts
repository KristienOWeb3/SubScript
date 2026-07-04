import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import {
    canApplicantResubmit,
    kindForAccountRole,
    parseSupportedCountryCodes,
    toPublicKycDto,
    validateApplicantPayload,
    type KycStatus,
    type PublicKycRecord,
} from "@/lib/kyc";
import { prisma } from "@/lib/prisma";

class KycRouteError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

function getKycConfiguration() {
    const provider = (process.env.KYC_PROVIDER_NAME || "manual").trim();
    const consentVersion = (process.env.KYC_CONSENT_VERSION || "2026-07-04").trim();
    if (!provider || provider.length > 50 || !consentVersion || consentVersion.length > 40) {
        throw new KycRouteError("KYC provider configuration is invalid", 500);
    }
    const supportedCountries = parseSupportedCountryCodes(
        process.env.KYC_SUPPORTED_COUNTRIES
        || (process.env.NODE_ENV === "production" ? undefined : "NG")
    );
    if (!supportedCountries.ok) {
        throw new KycRouteError(supportedCountries.error, 500);
    }

    const configuredPortalUrl = process.env.KYC_PROVIDER_PORTAL_URL?.trim();
    if (!configuredPortalUrl) {
        return {
            provider,
            consentVersion,
            supportedCountries: [...supportedCountries.data],
            portalUrl: undefined,
        };
    }
    try {
        const portalUrl = new URL(configuredPortalUrl);
        const isLocalDevelopmentUrl = process.env.NODE_ENV !== "production"
            && portalUrl.protocol === "http:"
            && ["localhost", "127.0.0.1", "[::1]"].includes(portalUrl.hostname);
        if (portalUrl.protocol !== "https:" && !isLocalDevelopmentUrl) {
            throw new Error("unsupported protocol");
        }
        return {
            provider,
            consentVersion,
            supportedCountries: [...supportedCountries.data],
            portalUrl: portalUrl.toString(),
        };
    } catch {
        throw new KycRouteError("KYC provider configuration is invalid", 500);
    }
}

function buildProviderRedirect(portalUrl: string | undefined, verificationId: string) {
    if (!portalUrl) return undefined;
    const redirectUrl = new URL(portalUrl);
    redirectUrl.searchParams.set("reference", verificationId);
    return redirectUrl.toString();
}

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const verification = await prisma.kycVerification.findUnique({
            where: { walletAddress: walletAddress.toLowerCase() },
        });
        const { portalUrl, supportedCountries } = getKycConfiguration();
        const redirectUrl = verification && ["PENDING", "IN_REVIEW"].includes(verification.status)
            ? buildProviderRedirect(portalUrl, verification.id)
            : undefined;

        return NextResponse.json({
            success: true,
            verification: verification
                ? toPublicKycDto(verification as PublicKycRecord)
                : null,
            ...(redirectUrl ? { redirectUrl } : {}),
            supportedCountries,
        });
    } catch (error) {
        console.error("Failed to load KYC verification:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const normalizedWallet = walletAddress.toLowerCase();
        const { provider, consentVersion, supportedCountries, portalUrl } = getKycConfiguration();
        if (
            process.env.NODE_ENV === "production"
            && (provider.toLowerCase() === "manual" || !portalUrl)
        ) {
            return NextResponse.json(
                { error: "KYC provider is not configured for production" },
                { status: 503 }
            );
        }
        const payload = validateApplicantPayload(
            await request.json().catch(() => null),
            new Set(supportedCountries)
        );
        if (!payload.ok) {
            return NextResponse.json({ error: payload.error }, { status: 400 });
        }
        const verification = await prisma.$transaction(async (tx) => {
            const roleRecord = await tx.accountRole.findUnique({
                where: { address: normalizedWallet },
                select: { role: true },
            });
            const kind = kindForAccountRole(roleRecord?.role);
            if (!roleRecord || !kind) {
                throw new KycRouteError(
                    "Account role is required. Please finish signup and choose user or enterprise.",
                    403
                );
            }

            const existing = await tx.kycVerification.findUnique({
                where: { walletAddress: normalizedWallet },
            });
            const now = new Date();

            if (!existing) {
                const created = await tx.kycVerification.create({
                    data: {
                        walletAddress: normalizedWallet,
                        accountRole: roleRecord.role,
                        kind,
                        countryCode: payload.data.countryCode,
                        provider,
                        requestedLevel: "STANDARD",
                        status: "PENDING",
                        reasonCode: null,
                        consentVersion,
                        consentedAt: now,
                        submittedAt: now,
                        revision: 1,
                    },
                });

                await tx.kycVerificationEvent.create({
                    data: {
                        verificationId: created.id,
                        actorType: "APPLICANT",
                        actorId: normalizedWallet,
                        fromStatus: null,
                        toStatus: "PENDING",
                        reasonCode: null,
                    },
                });
                await tx.auditEvent.create({
                    data: {
                        actor: normalizedWallet,
                        action: "KYC_VERIFICATION_STARTED",
                        resourceType: "KYC_VERIFICATION",
                        resourceId: created.id,
                        metadata: {
                            fromStatus: null,
                            toStatus: "PENDING",
                            revision: created.revision,
                        },
                    },
                });
                if (kind === "BUSINESS") {
                    await tx.merchant.upsert({
                        where: { walletAddress: normalizedWallet },
                        update: { verified: false },
                        create: { walletAddress: normalizedWallet, verified: false },
                    });
                }
                return created;
            }

            if (!canApplicantResubmit(existing.status as KycStatus)) {
                throw new KycRouteError(
                    `Verification cannot be resubmitted while status is ${existing.status}`,
                    409
                );
            }

            const update = await tx.kycVerification.updateMany({
                where: {
                    id: existing.id,
                    status: existing.status,
                    revision: existing.revision,
                },
                data: {
                    accountRole: roleRecord.role,
                    kind,
                    countryCode: payload.data.countryCode,
                    provider,
                    requestedLevel: "STANDARD",
                    status: "PENDING",
                    reasonCode: null,
                    consentVersion,
                    consentedAt: now,
                    submittedAt: now,
                    providerUpdatedAt: null,
                    decidedAt: null,
                    expiresAt: null,
                    revision: { increment: 1 },
                },
            });
            if (update.count !== 1) {
                throw new KycRouteError("Verification changed while the request was processing", 409);
            }

            const updated = await tx.kycVerification.findUniqueOrThrow({
                where: { id: existing.id },
            });
            await tx.kycVerificationEvent.create({
                data: {
                    verificationId: updated.id,
                    actorType: "APPLICANT",
                    actorId: normalizedWallet,
                    fromStatus: existing.status,
                    toStatus: "PENDING",
                    reasonCode: null,
                },
            });
            await tx.auditEvent.create({
                data: {
                    actor: normalizedWallet,
                    action: "KYC_VERIFICATION_RESUBMITTED",
                    resourceType: "KYC_VERIFICATION",
                    resourceId: updated.id,
                    metadata: {
                        fromStatus: existing.status,
                        toStatus: "PENDING",
                        revision: updated.revision,
                    },
                },
            });
            if (kind === "BUSINESS") {
                await tx.merchant.upsert({
                    where: { walletAddress: normalizedWallet },
                    update: { verified: false },
                    create: { walletAddress: normalizedWallet, verified: false },
                });
            }
            return updated;
        });

        const redirectUrl = buildProviderRedirect(portalUrl, verification.id);
        return NextResponse.json({
            success: true,
            verification: toPublicKycDto(verification as PublicKycRecord),
            ...(redirectUrl ? { redirectUrl } : {}),
        });
    } catch (error) {
        if (error instanceof KycRouteError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if ((error as { code?: string })?.code === "P2002") {
            return NextResponse.json(
                { error: "Verification changed while the request was processing" },
                { status: 409 }
            );
        }
        console.error("Failed to start KYC verification:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
