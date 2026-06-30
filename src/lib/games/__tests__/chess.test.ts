import assert from "node:assert/strict";
import test from "node:test";
import {
    INITIAL_FEN,
    applyChessMove,
    getLegalMoves,
    getLegalTargets,
    parseFen,
    perft,
    positionKey,
    serializeFen,
} from "../chess";

test("round-trips a valid FEN without losing clocks or rights", () => {
    const fen = "r3k2r/ppp2ppp/2n5/3pp3/8/2N2N2/PPPP1PPP/R3K2R w KQkq e6 7 12";
    assert.equal(serializeFen(parseFen(fen)), fen);
});

test("rejects malformed FEN input", () => {
    assert.throws(() => parseFen("8/8/8/8/8/8/8/8 w - - 0 1"), /king/i);
    assert.throws(() => parseFen("not a fen"), /FEN/i);
});

test("generates the standard opening move set", () => {
    const moves = getLegalMoves(INITIAL_FEN).map((move) => move.uci);
    assert.equal(moves.length, 20);
    assert.ok(moves.includes("e2e4"));
    assert.ok(moves.includes("g1f3"));
});

test("returns legal destinations for a selected square", () => {
    assert.deepEqual(getLegalTargets(INITIAL_FEN, "e2"), ["e3", "e4"]);
    assert.deepEqual(getLegalTargets(INITIAL_FEN, "e7"), []);
});

test("rejects a move that leaves the moving king in check", () => {
    const fen = "4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1";
    assert.deepEqual(getLegalTargets(fen, "e2"), ["e3", "e4", "e5", "e6", "e7", "e8"]);
    assert.throws(
        () => applyChessMove({ fen, from: "e2", to: "d2" }),
        /illegal/i,
    );
});

test("allows castling only through unattacked empty squares", () => {
    const clear = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    assert.ok(getLegalMoves(clear).some((move) => move.uci === "e1g1"));
    assert.ok(getLegalMoves(clear).some((move) => move.uci === "e1c1"));

    const attacked = "r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1";
    assert.ok(!getLegalMoves(attacked).some((move) => move.uci === "e1g1"));
});

test("moves the rook and updates rights when castling", () => {
    const result = applyChessMove({
        fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
        from: "e1",
        to: "g1",
    });

    assert.equal(result.san, "O-O");
    assert.equal(result.fen, "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1");
});

test("executes en passant and removes the passed pawn", () => {
    const result = applyChessMove({
        fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
        from: "e5",
        to: "d6",
    });

    assert.equal(result.fen, "4k3/8/3P4/8/8/8/8/4K3 b - - 0 2");
    assert.equal(result.san, "exd6");
});

test("requires and applies a legal pawn promotion", () => {
    const fen = "7k/P7/8/8/8/8/8/7K w - - 0 1";
    assert.deepEqual(
        getLegalMoves(fen)
            .filter((move) => move.from === "a7")
            .map((move) => move.uci)
            .sort(),
        ["a7a8b", "a7a8n", "a7a8q", "a7a8r"],
    );
    assert.throws(() => applyChessMove({ fen, from: "a7", to: "a8" }), /promotion/i);

    const result = applyChessMove({ fen, from: "a7", to: "a8", promotion: "q" });
    assert.equal(result.fen, "Q6k/8/8/8/8/8/8/7K b - - 0 1");
    assert.equal(result.san, "a8=Q+");
});

test("detects Fool's Mate as checkmate", () => {
    let state = applyChessMove({ fen: INITIAL_FEN, from: "f2", to: "f3" });
    state = applyChessMove({
        fen: state.fen,
        from: "e7",
        to: "e5",
        positionHistory: state.positionHistory,
    });
    state = applyChessMove({
        fen: state.fen,
        from: "g2",
        to: "g4",
        positionHistory: state.positionHistory,
    });
    state = applyChessMove({
        fen: state.fen,
        from: "d8",
        to: "h4",
        positionHistory: state.positionHistory,
    });

    assert.equal(state.san, "Qh4#");
    assert.equal(state.check, true);
    assert.deepEqual(state.outcome, {
        status: "CHECKMATE",
        reason: "CHECKMATE",
        winner: "b",
    });
});

test("detects stalemate", () => {
    const result = applyChessMove({
        fen: "7k/5K2/6Q1/8/8/8/8/8 w - - 0 1",
        from: "g6",
        to: "f5",
    });

    assert.deepEqual(result.outcome, {
        status: "DRAW",
        reason: "STALEMATE",
        winner: null,
    });
});

test("detects the fifty-move draw at one hundred halfmoves", () => {
    const result = applyChessMove({
        fen: "7k/8/8/8/8/8/2R5/K7 w - - 99 50",
        from: "c2",
        to: "c3",
    });

    assert.deepEqual(result.outcome, {
        status: "DRAW",
        reason: "FIFTY_MOVE",
        winner: null,
    });
});

test("detects insufficient mating material", () => {
    const result = applyChessMove({
        fen: "7k/8/8/8/8/8/2B5/K7 w - - 0 1",
        from: "c2",
        to: "b3",
    });

    assert.deepEqual(result.outcome, {
        status: "DRAW",
        reason: "INSUFFICIENT_MATERIAL",
        winner: null,
    });
});

test("detects threefold repetition from supplied canonical history", () => {
    const fen = "7k/8/8/8/8/8/2R5/K7 w - - 0 1";
    const nextFen = "7k/8/8/8/8/2R5/8/K7 b - - 1 1";
    const nextKey = positionKey(nextFen);
    const result = applyChessMove({
        fen,
        from: "c2",
        to: "c3",
        positionHistory: [positionKey(fen), nextKey, nextKey],
    });

    assert.deepEqual(result.outcome, {
        status: "DRAW",
        reason: "THREEFOLD_REPETITION",
        winner: null,
    });
});

test("normalizes unusable en-passant targets in repetition keys", () => {
    const withoutTarget = "4k3/8/8/3p4/8/8/8/4K3 w - - 0 2";
    const phantomTarget = "4k3/8/8/3p4/8/8/8/4K3 w - d6 0 2";
    assert.equal(positionKey(withoutTarget), positionKey(phantomTarget));
});

test("matches start-position perft reference counts", () => {
    assert.equal(perft(INITIAL_FEN, 1), 20);
    assert.equal(perft(INITIAL_FEN, 2), 400);
    assert.equal(perft(INITIAL_FEN, 3), 8_902);
});

test("matches Kiwipete perft reference counts", () => {
    const fen = "r3k2r/p1ppqpb1/bn2pnp1/2pP4/1p2P3/2N2N2/PPQ1BPPP/R1B1K2R w KQkq - 0 1";
    assert.equal(perft(fen, 1), 48);
    assert.equal(perft(fen, 2), 2_039);
    assert.equal(perft(fen, 3), 97_862);
});

test("matches the standard rook-and-pawn endgame perft counts", () => {
    const fen = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";
    assert.equal(perft(fen, 1), 14);
    assert.equal(perft(fen, 2), 191);
    assert.equal(perft(fen, 3), 2_812);
});
