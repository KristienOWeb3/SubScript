import { Metadata } from "next";
import { resolveInviteToken } from "@/lib/dms/inviteTokens";
import { prisma } from "@/lib/prisma";
import { accountDisplayName } from "@/lib/identityDisplay";
import InviteClient from "./InviteClient";

type PageProps = {
    params: Promise<{ token: string }>;
};

type ResolveResult = {
    valid: boolean;
    wallet?: string;
    error?: string;
    status?: "VALID" | "REVOKED" | "DISABLED" | "INVALID";
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { token } = await params;
    const resolution: ResolveResult = await resolveInviteToken(token).catch(() => ({ valid: false }));

    if (!resolution.valid || !resolution.wallet) {
        return {
            title: "DM Invite | SubScript",
            description: "Direct message invite link on SubScript.",
        };
    }

    const aliasRecord = await prisma.addressAlias.findUnique({
        where: { address: resolution.wallet.toLowerCase() },
        select: { alias: true },
    }).catch(() => null);

    const name = accountDisplayName(aliasRecord?.alias) || `${resolution.wallet.slice(0, 6)}...${resolution.wallet.slice(-4)}`;

    return {
        title: `Connect with ${name} | SubScript DMs`,
        description: `Send a direct message connection request to ${name} on SubScript.`,
    };
}

export default async function DmInvitePage({ params }: PageProps) {
    const { token } = await params;
    const resolution: ResolveResult = await resolveInviteToken(token).catch((err) => ({
        valid: false,
        error: err?.message || "Invalid invite link",
        status: "INVALID",
    }));

    let recipient = null;
    if (resolution.valid && resolution.wallet) {
        const wallet = resolution.wallet.toLowerCase();
        const [aliasRecord, customer] = await Promise.all([
            prisma.addressAlias.findUnique({
                where: { address: wallet },
                select: { alias: true },
            }).catch(() => null),
            prisma.customer.findUnique({
                where: { walletAddress: wallet },
                select: { profilePic: true },
            }).catch(() => null),
        ]);

        recipient = {
            walletAddress: wallet,
            displayName: accountDisplayName(aliasRecord?.alias) || `${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
            alias: aliasRecord?.alias || null,
            profilePic: customer?.profilePic || null,
        };
    }

    return (
        <InviteClient
            token={token}
            initialValid={resolution.valid}
            initialStatus={resolution.status || "INVALID"}
            initialError={resolution.error || null}
            initialRecipient={recipient}
        />
    );
}
