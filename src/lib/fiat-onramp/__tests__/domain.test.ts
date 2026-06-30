import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getFiatOnrampConfig, requireSandboxConfig } from "../config";
import { FiatOnrampError } from "../errors";
import {
    assertAmountWithinBounds,
    calculateQuote,
    parseNgnToKobo,
} from "../money";
import {
    decideSimulation,
    deterministicSimulationEventId,
    FUNDING_STATUS,
    isTerminalFundingStatus,
    resolveIdempotentCreate,
} from "../state";

test("parses NGN into kobo without floating point", () => {
    assert.equal(parseNgnToKobo("1"), BigInt(100));
    assert.equal(parseNgnToKobo("1.2"), BigInt(120));
    assert.equal(parseNgnToKobo("9007199254740993.01"), BigInt("900719925474099301"));

    for (const invalid of [1, "0", "-1", "1.001", "1e3", "01.00", "1,000.00"]) {
        assert.throws(() => parseNgnToKobo(invalid), FiatOnrampError);
    }
});

test("quotes micro-USDC by rounding division down", () => {
    assert.deepEqual(
        calculateQuote(BigInt(100), BigInt(300)),
        {
            grossUsdcMicros: BigInt(333333),
            feeFiatMinor: BigInt(0),
            netUsdcMicros: BigInt(333333),
        },
    );
    assert.deepEqual(
        calculateQuote(BigInt(10_000), BigInt(200), BigInt(100)),
        {
            grossUsdcMicros: BigInt(50_000_000),
            feeFiatMinor: BigInt(100),
            netUsdcMicros: BigInt(49_500_000),
        },
    );
});

test("enforces configured amount bounds inclusively", () => {
    assert.doesNotThrow(() => assertAmountWithinBounds(BigInt(100), BigInt(100), BigInt(200)));
    assert.doesNotThrow(() => assertAmountWithinBounds(BigInt(200), BigInt(100), BigInt(200)));
    assert.throws(
        () => assertAmountWithinBounds(BigInt(99), BigInt(100), BigInt(200)),
        (error: unknown) => error instanceof FiatOnrampError && error.code === "AMOUNT_OUT_OF_RANGE",
    );
});

test("only enables explicit sandbox mode on Arc testnet", () => {
    const sandbox = getFiatOnrampConfig({
        FIAT_ONRAMP_MODE: "sandbox",
        FIAT_ONRAMP_NETWORK: "arc-testnet",
        FIAT_ONRAMP_CHAIN_ID: "5042002",
    });
    assert.equal(sandbox.enabled, true);
    assert.equal(requireSandboxConfig(sandbox), sandbox);

    const wrongChain = getFiatOnrampConfig({
        FIAT_ONRAMP_MODE: "sandbox",
        FIAT_ONRAMP_NETWORK: "arc-testnet",
        FIAT_ONRAMP_CHAIN_ID: "5042001",
    });
    assert.equal(wrongChain.enabled, false);
    assert.throws(() => requireSandboxConfig(wrongChain), FiatOnrampError);

    const live = getFiatOnrampConfig({ FIAT_ONRAMP_MODE: "live" });
    assert.equal(live.enabled, false);
    assert.throws(() => requireSandboxConfig(live), FiatOnrampError);

    const disabled = getFiatOnrampConfig({});
    assert.equal(disabled.mode, "disabled");
    assert.equal(disabled.enabled, false);
});

test("keeps create replay and settlement terminal semantics idempotent", () => {
    assert.equal(resolveIdempotentCreate(BigInt(100), BigInt(100)), "replay");
    assert.throws(
        () => resolveIdempotentCreate(BigInt(100), BigInt(101)),
        (error: unknown) => error instanceof FiatOnrampError && error.status === 409,
    );

    const now = new Date("2026-06-29T12:00:00.000Z");
    assert.equal(
        decideSimulation(
            FUNDING_STATUS.AWAITING_TRANSFER,
            new Date("2026-06-29T12:01:00.000Z"),
            now,
        ),
        "transition",
    );
    assert.equal(
        decideSimulation(
            FUNDING_STATUS.SIMULATED_SETTLED,
            new Date("2026-06-29T11:59:00.000Z"),
            now,
        ),
        "replay",
    );
    assert.throws(
        () => decideSimulation(
            FUNDING_STATUS.AWAITING_TRANSFER,
            new Date("2026-06-29T12:00:00.000Z"),
            now,
        ),
        (error: unknown) =>
            error instanceof FiatOnrampError && error.code === "FUNDING_INTENT_EXPIRED",
    );
    assert.equal(isTerminalFundingStatus(FUNDING_STATUS.FAILED), true);
    assert.equal(
        deterministicSimulationEventId("intent-id"),
        "subscript-sandbox:settled:intent-id",
    );
});

test("migration and service retain the server-only concurrency controls", () => {
    const migration = readFileSync(
        join(
            process.cwd(),
            "supabase",
            "migrations",
            "20260703000000_create_fiat_funding_intents.sql",
        ),
        "utf8",
    );
    assert.match(migration, /UNIQUE \(wallet_address, idempotency_key\)/i);
    assert.match(migration, /UNIQUE \(provider_event_id\)/i);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/gi);
    assert.match(migration, /USING \(false\)[\s\S]*WITH CHECK \(false\)/i);
    assert.match(migration, /REVOKE ALL PRIVILEGES[\s\S]*anon, authenticated/i);
    assert.match(migration, /destination_chain_id = 5042002/i);
    assert.match(migration, /fiat_funding_intents_one_active_per_wallet_idx/i);

    const service = readFileSync(
        join(process.cwd(), "src", "lib", "fiat-onramp", "service.ts"),
        "utf8",
    );
    assert.match(
        service,
        /updateMany\(\{[\s\S]*status:\s*FUNDING_STATUS\.AWAITING_TRANSFER[\s\S]*expiresAt:\s*\{\s*gt:\s*now\s*\}/,
    );
    assert.match(service, /deterministicSimulationEventId\(intent\.id\)/);
    assert.match(service, /transition\.count === 1/);
});
