import { prisma } from "@/lib/prisma";

export type AccountRoleName = "USER" | "ENTERPRISE";

export async function getAccountRole(address: string | null | undefined) {
    if (!address) return null;
    const record = await prisma.accountRole.findUnique({
        where: { address: address.toLowerCase() },
        select: { role: true },
    });
    return record?.role as AccountRoleName | undefined || null;
}

export async function requireAccountRole(address: string, expectedRole: AccountRoleName) {
    const role = await getAccountRole(address);
    if (!role) {
        return {
            ok: false as const,
            status: 403,
            error: "Account role is required. Please finish signup and choose user or enterprise.",
        };
    }
    if (role !== expectedRole) {
        return {
            ok: false as const,
            status: 403,
            error: expectedRole === "ENTERPRISE"
                ? "This action requires an enterprise merchant wallet."
                : "This action requires a user wallet.",
        };
    }
    return { ok: true as const, role };
}
