import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
    paymentIdentityMetadata,
    resolveFulfillmentAddress,
    validateBeneficiaryAddress,
} from "../beneficiary.ts";

const merchant = "0x1111111111111111111111111111111111111111";
const beneficiary = "0x2222222222222222222222222222222222222222";
const payer = "0x3333333333333333333333333333333333333333";

test("accepts an optional valid beneficiary and normalizes it", () => {
    assert.deepEqual(validateBeneficiaryAddress(undefined, merchant), {
        ok: true,
        address: null,
    });
    assert.deepEqual(validateBeneficiaryAddress(beneficiary.toUpperCase().replace("0X", "0x"), merchant), {
        ok: true,
        address: beneficiary,
    });
});

test("rejects malformed and merchant-owned beneficiary addresses", () => {
    assert.deepEqual(validateBeneficiaryAddress("not-a-wallet", merchant), {
        ok: false,
        error: "Bad Request: beneficiary_address must be a valid wallet address",
    });
    assert.deepEqual(validateBeneficiaryAddress(merchant.toUpperCase().replace("0X", "0x"), merchant), {
        ok: false,
        error: "Bad Request: A merchant cannot be the beneficiary of its own payment link",
    });
});

test("keeps payer and fulfillment identities separate", () => {
    assert.equal(resolveFulfillmentAddress(beneficiary, payer), beneficiary);
    assert.equal(resolveFulfillmentAddress(null, payer), payer);
    assert.deepEqual(paymentIdentityMetadata(payer, beneficiary), {
        payer_address: payer,
        payerAddress: payer,
        beneficiary_address: beneficiary,
        beneficiaryAddress: beneficiary,
    });
});

test("migration persists beneficiary snapshots and enforces merchant separation", () => {
    const migration = readFileSync(
        join(
            process.cwd(),
            "supabase",
            "migrations",
            "20260704000000_add_payment_link_beneficiaries.sql",
        ),
        "utf8",
    );

    assert.match(migration, /ALTER TABLE payment_links[\s\S]*beneficiary_address TEXT/i);
    assert.match(migration, /ALTER TABLE payment_link_payments[\s\S]*beneficiary_address TEXT/i);
    assert.match(migration, /ALTER TABLE receipts[\s\S]*beneficiary_address TEXT/i);
    assert.match(migration, /payment_links_beneficiary_not_merchant/i);
});

test("creation and verification routes retain beneficiary role and audit boundaries", () => {
    const createRoute = readFileSync(
        join(process.cwd(), "src", "app", "api", "payment-links", "route.ts"),
        "utf8",
    );
    const verifyRoute = readFileSync(
        join(process.cwd(), "src", "app", "api", "payment-links", "verify", "route.ts"),
        "utf8",
    );
    const verificationWorker = readFileSync(
        join(process.cwd(), "src", "lib", "payments", "paymentLinkVerificationWorker.ts"),
        "utf8",
    );

    assert.match(createRoute, /\.from\("account_roles"\)[\s\S]*beneficiaryRole\?\.role !== "USER"/);
    assert.match(createRoute, /beneficiary_address:\s*normalizedBeneficiary/);
    assert.match(verifyRoute, /payer_address:\s*normalizedPayer[\s\S]*beneficiary_address:\s*normalizedBeneficiary/);
    /* Verification is durable now: the request persists the normalized identities, then the
       claimed worker maps those immutable fields into webhook/audit DTOs. */
    assert.match(verificationWorker, /payerAddress:\s*job\.payer_address[\s\S]*beneficiaryAddress:\s*job\.beneficiary_address/);
});
