import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDatabaseUrl } from "@/lib/databaseUrl";
import {
    isConnectionError,
    getOfflineAccountRole,
    upsertOfflineAccountRole,
    upsertOfflineMerchant,
    upsertOfflineCustomer
} from "./offlineDb";

/* Prevent multiple instantiations of Prisma Client in development mode */
// Ensure BigInt values serialize cleanly to JSON across all API handlers and Prisma models
if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
    (BigInt.prototype as any).toJSON = function () {
        return this.toString();
    };
}
/* The JSON-backed fallback is a local-development convenience only. In production it can
 * turn a failed database mutation into a false success response, which is unacceptable for
 * admin, KYC, and financial writes. Production must surface the original Prisma error so
 * callers can retry or fail closed. */
const offlineFallbackEnabled = process.env.NODE_ENV !== "production";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

/* Prisma 7 removed the `datasources` constructor override along with `url` in the schema: the client
   is handed a driver adapter instead, and queries run over that driver rather than Prisma's own
   engine connection. PrismaPg wraps node-postgres, which this project already depends on for the raw
   `serverPg` layer, so both paths now pool through the same driver.
   The URL still comes from getDatabaseUrl, which prefers the pooler and keeps the build-time
   fallback — `next build` imports modules that reach this file, and must not need real credentials
   to do it. */
const rawPrisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        adapter: new PrismaPg({
            connectionString: getDatabaseUrl({ allowBuildTimeFallback: true, forPrisma: true }),
        }),
        log: ["query"],
    });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rawPrisma;

function createDelegateProxy(delegate: any, overrides: Record<string, (...args: any[]) => Promise<any>>) {
    return new Proxy(delegate, {
        get(target, prop, receiver) {
            if (typeof prop === "string" && overrides[prop]) {
                return overrides[prop];
            }

            const value = Reflect.get(target, prop, receiver);
            if (typeof value === "function") {
                return value.bind(target);
            }
            return value;
        },
    });
}

function createPrismaProxy(client: any): any {
    return new Proxy(client, {
        get(target, prop, receiver) {
            if (prop === "accountRole") {
                return createDelegateProxy(target.accountRole, {
                    findUnique: async (args: any) => {
                        try {
                            return await target.accountRole.findUnique(args);
                        } catch (err) {
                            if (offlineFallbackEnabled && isConnectionError(err)) {
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
                            if (offlineFallbackEnabled && isConnectionError(err)) {
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
                });
            }
            if (prop === "merchant") {
                return createDelegateProxy(target.merchant, {
                    findUnique: async (args: any) => {
                        try {
                            return await target.merchant.findUnique(args);
                        } catch (err) {
                            if (offlineFallbackEnabled && isConnectionError(err)) {
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
                            if (offlineFallbackEnabled && isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for merchant.upsert.");
                                const address = args?.where?.walletAddress || args?.create?.walletAddress;
                                upsertOfflineMerchant(address);
                                return { walletAddress: address, tier: "FREE", availableBalanceUsdc: BigInt(0), reservedBalanceUsdc: BigInt(0) };
                            }
                            throw err;
                        }
                    }
                });
            }
            if (prop === "customer") {
                return createDelegateProxy(target.customer, {
                    findUnique: async (args: any) => {
                        try {
                            return await target.customer.findUnique(args);
                        } catch (err) {
                            if (offlineFallbackEnabled && isConnectionError(err)) {
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
                            if (offlineFallbackEnabled && isConnectionError(err)) {
                                console.warn("⚠️ Database is offline. Falling back to local offlineDb for customer.upsert.");
                                const address = args?.where?.walletAddress || args?.create?.walletAddress;
                                upsertOfflineCustomer(address);
                                return { walletAddress: address };
                            }
                            throw err;
                        }
                    }
                });
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
