import { PrismaClient } from "@prisma/client";
import { 
    isConnectionError, 
    getOfflineAccountRole, 
    upsertOfflineAccountRole,
    upsertOfflineMerchant,
    upsertOfflineCustomer
} from "./offlineDb";

/* Prevent multiple instantiations of Prisma Client in development mode */
const globalForPrisma = global as unknown as { prisma: PrismaClient };

const rawPrisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: ["query"],
    });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rawPrisma;

function createPrismaProxy(client: any): any {
    return new Proxy(client, {
        get(target, prop, receiver) {
            if (prop === "accountRole") {
                return {
                    findUnique: async (args: any) => {
                        try {
                            return await target.accountRole.findUnique(args);
                        } catch (err) {
                            if (isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for accountRole.findUnique.");
                                const address = args?.where?.address;
                                if (!address) return null;
                                const role = getOfflineAccountRole(address);
                                if (!role) return null;
                                return { address, role, createdAt: new Date(), updatedAt: new Date() };
                            }
                            throw err;
                        }
                    },
                    upsert: async (args: any) => {
                        try {
                            return await target.accountRole.upsert(args);
                        } catch (err) {
                            if (isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for accountRole.upsert.");
                                const address = args?.where?.address || args?.create?.address;
                                const role = args?.update?.role || args?.create?.role;
                                if (!address || !role) throw new Error("Missing address or role for upsert");
                                upsertOfflineAccountRole(address, role);
                                return { address, role, createdAt: new Date(), updatedAt: new Date() };
                            }
                            throw err;
                        }
                    }
                };
            }
            if (prop === "merchant") {
                return {
                    findUnique: async (args: any) => {
                        try {
                            return await target.merchant.findUnique(args);
                        } catch (err) {
                            if (isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for merchant.findUnique.");
                                const address = args?.where?.walletAddress;
                                return { walletAddress: address, tier: "FREE", availableBalanceUsdc: BigInt(0), reservedBalanceUsdc: BigInt(0) };
                            }
                            throw err;
                        }
                    },
                    upsert: async (args: any) => {
                        try {
                            return await target.merchant.upsert(args);
                        } catch (err) {
                            if (isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for merchant.upsert.");
                                const address = args?.where?.walletAddress || args?.create?.walletAddress;
                                upsertOfflineMerchant(address);
                                return { walletAddress: address, tier: "FREE", availableBalanceUsdc: BigInt(0), reservedBalanceUsdc: BigInt(0) };
                            }
                            throw err;
                        }
                    }
                };
            }
            if (prop === "customer") {
                return {
                    findUnique: async (args: any) => {
                        try {
                            return await target.customer.findUnique(args);
                        } catch (err) {
                            if (isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for customer.findUnique.");
                                const address = args?.where?.walletAddress;
                                return { walletAddress: address };
                            }
                            throw err;
                        }
                    },
                    upsert: async (args: any) => {
                        try {
                            return await target.customer.upsert(args);
                        } catch (err) {
                            if (isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for customer.upsert.");
                                const address = args?.where?.walletAddress || args?.create?.walletAddress;
                                upsertOfflineCustomer(address);
                                return { walletAddress: address };
                            }
                            throw err;
                        }
                    }
                };
            }

            const value = Reflect.get(target, prop, receiver);
            if (typeof value === "function") {
                return function (this: any, ...args: any[]) {
                    return value.apply(this, args);
                };
            }
            return value;
        }
    });
}

export const prisma: PrismaClient = createPrismaProxy(rawPrisma);
