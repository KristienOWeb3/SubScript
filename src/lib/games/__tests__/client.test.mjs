import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    isSandboxDmGame,
    requireGameEscrowAddress,
} from "../client.ts";

test("keeps sandbox games off-chain", () => {
    assert.equal(isSandboxDmGame({ mode: "sandbox", contractAddress: null }), true);
    assert.throws(
        () => requireGameEscrowAddress({ mode: "sandbox", contractAddress: null }),
        /only available for testnet games/i,
    );
});

test("fails closed when a testnet game has no configured escrow", () => {
    assert.throws(
        () => requireGameEscrowAddress({ mode: "testnet", contractAddress: null }),
        /escrow is not configured/i,
    );
    assert.throws(
        () => requireGameEscrowAddress({ mode: "testnet", contractAddress: "0x1234" }),
        /escrow is not configured/i,
    );
});

test("uses the escrow address recorded on a testnet game", () => {
    const address = "0x1111111111111111111111111111111111111111";
    assert.equal(
        requireGameEscrowAddress({ mode: "testnet", contractAddress: address }),
        address,
    );
});

test("client entry points do not contain an escrow fallback", () => {
    const entryPoints = [
        "../../../components/games/GamesModals.tsx",
        "../../../app/pay/game/[id]/GameInviteClient.tsx",
        "../../../app/dashboard/user/page.tsx",
    ];

    for (const entryPoint of entryPoints) {
        const source = readFileSync(new URL(entryPoint, import.meta.url), "utf8");
        assert.doesNotMatch(source, /NEXT_PUBLIC_DM_GAME_ESCROW_ADDRESS\s*\|\|/);
        assert.doesNotMatch(source, /0xCFc7Db58d256688Bea3dE0a063d0bCF9137a237D/i);
        assert.match(source, /isSandboxDmGame/);
        assert.match(source, /requireGameEscrowAddress/);
    }
});
