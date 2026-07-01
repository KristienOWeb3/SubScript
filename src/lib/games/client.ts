type ClientDmGame = {
    mode?: string | null;
    contractAddress?: string | null;
};

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

export function isSandboxDmGame(game: ClientDmGame) {
    return game.mode === "sandbox";
}

export function requireGameEscrowAddress(game: ClientDmGame): `0x${string}` {
    if (game.mode !== "testnet") {
        throw new Error("On-chain escrow is only available for testnet games");
    }

    const address = game.contractAddress?.trim();
    if (!address || !addressPattern.test(address)) {
        throw new Error("Game escrow is not configured; no funds were moved");
    }

    return address as `0x${string}`;
}
