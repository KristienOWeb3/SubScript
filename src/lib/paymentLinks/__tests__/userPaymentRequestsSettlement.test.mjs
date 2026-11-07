import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("createUserPaymentRequest includes settlement_chain_id and simulation_only in SQL insert", () => {
    const filePath = path.resolve(process.cwd(), "src/lib/userPaymentRequests.ts");
    const content = fs.readFileSync(filePath, "utf8");

    assert.ok(
        content.includes("settlement_chain_id"),
        "userPaymentRequests.ts must explicitly include settlement_chain_id in INSERT"
    );
    assert.ok(
        content.includes("simulation_only"),
        "userPaymentRequests.ts must explicitly include simulation_only in INSERT"
    );
    assert.ok(
        content.includes("ProtocolConfig.CHAIN_ID"),
        "userPaymentRequests.ts must pass ProtocolConfig.CHAIN_ID as settlement chain parameter"
    );
    assert.ok(
        content.includes("insert into merchants (wallet_address)"),
        "userPaymentRequests.ts must insert into merchants to satisfy payment_links_merchant_address_fkey"
    );
});

