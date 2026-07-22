import fs from "fs";
import path from "path";

const MOCK_DB_FILE = path.join(process.cwd(), "prisma_mock_db.json");

interface MockDbSchema {
    accountRoles: Array<{ address: string; role: string; createdAt: string; updatedAt: string }>;
    otpCodes: Array<{ email: string; code: string; expires_at: string }>;
    userEmbeddedWallets: Array<{ email: string; wallet_address: string; encrypted_private_key: string }>;
    merchants: Array<{ wallet_address: string; tier: string; availableBalanceUsdc?: string; reservedBalanceUsdc?: string }>;
    customers: Array<{ wallet_address: string }>;
}

function getInitialDb(): MockDbSchema {
    return {
        accountRoles: [],
        otpCodes: [],
        userEmbeddedWallets: [],
        merchants: [],
        customers: []
    };
}

export function readMockDb(): MockDbSchema {
    try {
        if (!fs.existsSync(MOCK_DB_FILE)) {
            const initial = getInitialDb();
            fs.writeFileSync(MOCK_DB_FILE, JSON.stringify(initial, null, 2), "utf-8");
            return initial;
        }
        const content = fs.readFileSync(MOCK_DB_FILE, "utf-8");
        return JSON.parse(content);
    } catch (err) {
        console.error("Failed to read mock db file, returning empty schema:", err);
        return getInitialDb();
    }
}

export function writeMockDb(data: MockDbSchema) {
    try {
        fs.writeFileSync(MOCK_DB_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
        console.error("Failed to write mock db file:", err);
    }
}

// Check if an error is a database connectivity/paused/unconfigured error
export function isConnectionError(err: any): boolean {
    const msg = String(err?.message || err || "").toLowerCase();
    const code = String(err?.code || "").toLowerCase();
    
    return (
        code.startsWith("p1") || 
        code === "p2024" || 
        msg.includes("can't reach database server") ||
        msg.includes("not found") ||
        msg.includes("enotfound") ||
        msg.includes("econnrefused") ||
        msg.includes("etimedout") ||
        msg.includes("connection error") ||
        msg.includes("failed to connect") ||
        msg.includes("pool timeout") ||
        msg.includes("db.jkrlsjpsytzffwjpixue.supabase.co") ||
        msg.includes("supabase client not initialized") ||
        msg.includes("database_url") ||
        msg.includes("database url")
    );
}

// Clear mock data (called when wiping data)
export function wipeMockDb() {
    writeMockDb(getInitialDb());
    console.log("Mock database wiped successfully.");
}

// Account Roles Helper
export function getOfflineAccountRole(address: string): string | null {
    const db = readMockDb();
    const found = db.accountRoles.find(r => r.address.toLowerCase() === address.toLowerCase());
    return found ? found.role : null;
}

export function upsertOfflineAccountRole(address: string, role: string) {
    const db = readMockDb();
    const normAddress = address.toLowerCase();
    const existingIdx = db.accountRoles.findIndex(r => r.address.toLowerCase() === normAddress);
    const nowStr = new Date().toISOString();
    
    if (existingIdx >= 0) {
        db.accountRoles[existingIdx].role = role;
        db.accountRoles[existingIdx].updatedAt = nowStr;
    } else {
        db.accountRoles.push({
            address: normAddress,
            role,
            createdAt: nowStr,
            updatedAt: nowStr
        });
    }
    writeMockDb(db);
}

// OTP Codes Helper
export function retrieveLocalOtpCode(email: string) {
    const db = readMockDb();
    const found = db.otpCodes.find(o => o.email.toLowerCase() === email.toLowerCase());
    if (found && new Date() > new Date(found.expires_at)) {
        deleteOfflineOtpCode(email);
        return null;
    }
    return found || null;
}

export function storeLocalOtpCode(email: string, code: string, expiresAt: Date) {
    const db = readMockDb();
    const normEmail = email.toLowerCase();
    const existingIdx = db.otpCodes.findIndex(o => o.email.toLowerCase() === normEmail);
    
    const entry = {
        email: normEmail,
        code,
        expires_at: expiresAt.toISOString()
    };
    
    if (existingIdx >= 0) {
        db.otpCodes[existingIdx] = entry;
    } else {
        db.otpCodes.push(entry);
    }
    writeMockDb(db);
}

export function deleteOfflineOtpCode(email: string) {
    const db = readMockDb();
    const normEmail = email.toLowerCase();
    db.otpCodes = db.otpCodes.filter(o => o.email.toLowerCase() !== normEmail);
    writeMockDb(db);
}

// Embedded Wallets Helper
export function getOfflineUserEmbeddedWallet(email: string) {
    const db = readMockDb();
    const found = db.userEmbeddedWallets.find(w => w.email.toLowerCase() === email.toLowerCase());
    return found || null;
}

export function getOfflineUserEmbeddedWalletByAddress(address: string) {
    const db = readMockDb();
    const found = db.userEmbeddedWallets.find(w => w.wallet_address.toLowerCase() === address.toLowerCase());
    return found || null;
}

export function saveOfflineUserEmbeddedWallet(email: string, walletAddress: string, encryptedPrivateKey: string) {
    const db = readMockDb();
    const normEmail = email.toLowerCase();
    const normAddress = walletAddress.toLowerCase();
    const existingIdx = db.userEmbeddedWallets.findIndex(w => w.email.toLowerCase() === normEmail);
    
    const entry = {
        email: normEmail,
        wallet_address: normAddress,
        encrypted_private_key: encryptedPrivateKey
    };
    
    if (existingIdx >= 0) {
        db.userEmbeddedWallets[existingIdx] = entry;
    } else {
        db.userEmbeddedWallets.push(entry);
    }
    writeMockDb(db);
}

// Merchant Helper
export function upsertOfflineMerchant(walletAddress: string, tier: string = "FREE") {
    const db = readMockDb();
    const normAddress = walletAddress.toLowerCase();
    const exists = db.merchants.some(m => m.wallet_address.toLowerCase() === normAddress);
    if (!exists) {
        db.merchants.push({
            wallet_address: normAddress,
            tier,
            availableBalanceUsdc: "0",
            reservedBalanceUsdc: "0"
        });
        writeMockDb(db);
    }
}

// Customer Helper
export function upsertOfflineCustomer(walletAddress: string) {
    const db = readMockDb();
    const normAddress = walletAddress.toLowerCase();
    const exists = db.customers.some(c => c.wallet_address.toLowerCase() === normAddress);
    if (!exists) {
        db.customers.push({
            wallet_address: normAddress
        });
        writeMockDb(db);
    }
}
