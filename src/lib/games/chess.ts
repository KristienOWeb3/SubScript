export const INITIAL_FEN =
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type ChessColor = "w" | "b";
export type ChessPieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PromotionPiece = "q" | "r" | "b" | "n";

export interface ChessPiece {
    readonly color: ChessColor;
    readonly type: ChessPieceType;
}

export interface ChessPosition {
    readonly board: ReadonlyArray<ChessPiece | null>;
    readonly turn: ChessColor;
    readonly castling: string;
    readonly enPassant: number | null;
    readonly halfmoveClock: number;
    readonly fullmoveNumber: number;
}

export interface ChessLegalMove {
    readonly uci: string;
    readonly from: string;
    readonly to: string;
    readonly piece: ChessPieceType;
    readonly promotion?: PromotionPiece;
    readonly capture: boolean;
    readonly castle?: "king" | "queen";
    readonly san: string;
}

export type ChessDrawReason =
    | "STALEMATE"
    | "FIFTY_MOVE"
    | "THREEFOLD_REPETITION"
    | "INSUFFICIENT_MATERIAL";

export type ChessOutcome =
    | {
        readonly status: "ACTIVE";
        readonly reason: null;
        readonly winner: null;
    }
    | {
        readonly status: "CHECKMATE";
        readonly reason: "CHECKMATE";
        readonly winner: ChessColor;
    }
    | {
        readonly status: "DRAW";
        readonly reason: ChessDrawReason;
        readonly winner: null;
    };

export interface ApplyChessMoveInput {
    readonly fen: string;
    readonly from: string;
    readonly to: string;
    readonly promotion?: PromotionPiece;
    readonly positionHistory?: ReadonlyArray<string>;
}

export interface ApplyChessMoveResult {
    readonly fen: string;
    readonly turn: ChessColor;
    readonly legalMoves: ReadonlyArray<string>;
    readonly outcome: ChessOutcome;
    readonly check: boolean;
    readonly san: string;
    readonly uci: string;
    readonly positionKey: string;
    readonly positionHistory: ReadonlyArray<string>;
}

const FILES = "abcdefgh";
const PIECE_PATTERN = /^[prnbqkPRNBQK]$/;
const SQUARE_PATTERN = /^[a-h][1-8]$/;
const PROMOTIONS: ReadonlyArray<PromotionPiece> = ["q", "r", "b", "n"];

const CAPTURE = 1 << 0;
const DOUBLE_PAWN = 1 << 1;
const EN_PASSANT = 1 << 2;
const KING_CASTLE = 1 << 3;
const QUEEN_CASTLE = 1 << 4;
const PROMOTION = 1 << 5;

interface InternalMove {
    readonly from: number;
    readonly to: number;
    readonly piece: ChessPiece;
    readonly captured: ChessPiece | null;
    readonly promotion?: PromotionPiece;
    readonly flags: number;
}

function opposite(color: ChessColor): ChessColor {
    return color === "w" ? "b" : "w";
}

function fileOf(index: number): number {
    return index % 8;
}

function rankOf(index: number): number {
    return Math.floor(index / 8);
}

function indexOf(file: number, rank: number): number {
    return rank * 8 + file;
}

function isOnBoard(file: number, rank: number): boolean {
    return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

export function squareToIndex(square: string): number {
    if (!SQUARE_PATTERN.test(square)) {
        throw new Error(`Invalid chess square: ${square}`);
    }

    return indexOf(FILES.indexOf(square[0]), Number(square[1]) - 1);
}

export function indexToSquare(index: number): string {
    if (!Number.isInteger(index) || index < 0 || index >= 64) {
        throw new Error(`Invalid chess board index: ${index}`);
    }

    return `${FILES[fileOf(index)]}${rankOf(index) + 1}`;
}

function pieceFromFen(character: string): ChessPiece {
    return {
        color: character === character.toUpperCase() ? "w" : "b",
        type: character.toLowerCase() as ChessPieceType,
    };
}

function pieceToFen(piece: ChessPiece): string {
    const character = piece.type;
    return piece.color === "w" ? character.toUpperCase() : character;
}

function parseClock(value: string, name: string, minimum: number): number {
    if (!/^\d+$/.test(value)) {
        throw new Error(`Invalid FEN ${name}`);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
        throw new Error(`Invalid FEN ${name}`);
    }

    return parsed;
}

export function parseFen(fen: string): ChessPosition {
    if (typeof fen !== "string") {
        throw new Error("FEN must be a string");
    }

    const fields = fen.trim().split(/\s+/);
    if (fields.length !== 6) {
        throw new Error("FEN must contain six fields");
    }

    const [placement, turnField, castlingField, enPassantField, halfmoveField, fullmoveField] =
        fields;
    const fenRanks = placement.split("/");
    if (fenRanks.length !== 8) {
        throw new Error("Invalid FEN board placement");
    }

    const board: Array<ChessPiece | null> = Array.from({ length: 64 }, () => null);
    let whiteKings = 0;
    let blackKings = 0;

    fenRanks.forEach((fenRank, fenRankIndex) => {
        let file = 0;
        const boardRank = 7 - fenRankIndex;

        for (const character of fenRank) {
            if (/^[1-8]$/.test(character)) {
                file += Number(character);
                continue;
            }

            if (!PIECE_PATTERN.test(character) || file >= 8) {
                throw new Error("Invalid FEN board placement");
            }

            const piece = pieceFromFen(character);
            board[indexOf(file, boardRank)] = piece;
            file += 1;
            if (piece.type === "k") {
                if (piece.color === "w") {
                    whiteKings += 1;
                } else {
                    blackKings += 1;
                }
            }
        }

        if (file !== 8) {
            throw new Error("Invalid FEN board placement");
        }
    });

    if (whiteKings !== 1 || blackKings !== 1) {
        throw new Error("A FEN position must contain exactly one king per color");
    }

    if (turnField !== "w" && turnField !== "b") {
        throw new Error("Invalid FEN active color");
    }

    if (
        castlingField !== "-"
        && !/^(?:K?Q?k?q?)$/.test(castlingField)
    ) {
        throw new Error("Invalid FEN castling rights");
    }

    let enPassant: number | null = null;
    if (enPassantField !== "-") {
        if (!/^[a-h][36]$/.test(enPassantField)) {
            throw new Error("Invalid FEN en-passant square");
        }
        if (
            (turnField === "w" && enPassantField[1] !== "6")
            || (turnField === "b" && enPassantField[1] !== "3")
        ) {
            throw new Error("Invalid FEN en-passant rank for the active color");
        }
        enPassant = squareToIndex(enPassantField);
    }

    return {
        board,
        turn: turnField,
        castling: castlingField === "-" ? "" : castlingField,
        enPassant,
        halfmoveClock: parseClock(halfmoveField, "halfmove clock", 0),
        fullmoveNumber: parseClock(fullmoveField, "fullmove number", 1),
    };
}

function boardPlacement(position: ChessPosition): string {
    const ranks: string[] = [];

    for (let rank = 7; rank >= 0; rank -= 1) {
        let empty = 0;
        let value = "";
        for (let file = 0; file < 8; file += 1) {
            const piece = position.board[indexOf(file, rank)];
            if (!piece) {
                empty += 1;
                continue;
            }
            if (empty > 0) {
                value += String(empty);
                empty = 0;
            }
            value += pieceToFen(piece);
        }
        if (empty > 0) {
            value += String(empty);
        }
        ranks.push(value);
    }

    return ranks.join("/");
}

export function serializeFen(position: ChessPosition): string {
    const castling = position.castling || "-";
    const enPassant =
        position.enPassant === null ? "-" : indexToSquare(position.enPassant);
    return [
        boardPlacement(position),
        position.turn,
        castling,
        enPassant,
        position.halfmoveClock,
        position.fullmoveNumber,
    ].join(" ");
}

function findKing(position: ChessPosition, color: ChessColor): number {
    const king = position.board.findIndex(
        (piece) => piece?.color === color && piece.type === "k",
    );
    if (king < 0) {
        throw new Error(`Position has no ${color === "w" ? "white" : "black"} king`);
    }
    return king;
}

export function isSquareAttacked(
    position: ChessPosition,
    square: number | string,
    byColor: ChessColor,
): boolean {
    const target = typeof square === "string" ? squareToIndex(square) : square;
    const targetFile = fileOf(target);
    const targetRank = rankOf(target);

    for (let from = 0; from < 64; from += 1) {
        const piece = position.board[from];
        if (!piece || piece.color !== byColor) {
            continue;
        }

        const fromFile = fileOf(from);
        const fromRank = rankOf(from);
        const fileDelta = targetFile - fromFile;
        const rankDelta = targetRank - fromRank;

        if (piece.type === "p") {
            const direction = byColor === "w" ? 1 : -1;
            if (rankDelta === direction && Math.abs(fileDelta) === 1) {
                return true;
            }
            continue;
        }

        if (piece.type === "n") {
            if (
                (Math.abs(fileDelta) === 1 && Math.abs(rankDelta) === 2)
                || (Math.abs(fileDelta) === 2 && Math.abs(rankDelta) === 1)
            ) {
                return true;
            }
            continue;
        }

        if (piece.type === "k") {
            if (Math.max(Math.abs(fileDelta), Math.abs(rankDelta)) === 1) {
                return true;
            }
            continue;
        }

        const diagonal = Math.abs(fileDelta) === Math.abs(rankDelta);
        const straight = fileDelta === 0 || rankDelta === 0;
        if (
            (piece.type === "b" && !diagonal)
            || (piece.type === "r" && !straight)
            || (piece.type === "q" && !diagonal && !straight)
        ) {
            continue;
        }

        const fileStep = Math.sign(fileDelta);
        const rankStep = Math.sign(rankDelta);
        let file = fromFile + fileStep;
        let rank = fromRank + rankStep;
        let blocked = false;
        while (file !== targetFile || rank !== targetRank) {
            if (position.board[indexOf(file, rank)]) {
                blocked = true;
                break;
            }
            file += fileStep;
            rank += rankStep;
        }
        if (!blocked) {
            return true;
        }
    }

    return false;
}

export function isInCheck(position: ChessPosition, color = position.turn): boolean {
    return isSquareAttacked(position, findKing(position, color), opposite(color));
}

function createMove(
    position: ChessPosition,
    from: number,
    to: number,
    flags = 0,
    promotion?: PromotionPiece,
    capturedOverride?: ChessPiece | null,
): InternalMove {
    const piece = position.board[from];
    if (!piece) {
        throw new Error("Cannot create a move from an empty square");
    }
    const captured =
        capturedOverride === undefined ? position.board[to] : capturedOverride;

    return {
        from,
        to,
        piece,
        captured,
        promotion,
        flags: flags | (captured ? CAPTURE : 0),
    };
}

function addPawnMoves(
    position: ChessPosition,
    from: number,
    moves: InternalMove[],
): void {
    const piece = position.board[from];
    if (!piece || piece.type !== "p") {
        return;
    }

    const fromFile = fileOf(from);
    const fromRank = rankOf(from);
    const direction = piece.color === "w" ? 1 : -1;
    const startRank = piece.color === "w" ? 1 : 6;
    const promotionRank = piece.color === "w" ? 7 : 0;
    const nextRank = fromRank + direction;

    if (isOnBoard(fromFile, nextRank)) {
        const oneStep = indexOf(fromFile, nextRank);
        if (!position.board[oneStep]) {
            if (nextRank === promotionRank) {
                for (const promotion of PROMOTIONS) {
                    moves.push(
                        createMove(position, from, oneStep, PROMOTION, promotion),
                    );
                }
            } else {
                moves.push(createMove(position, from, oneStep));
                const doubleRank = fromRank + direction * 2;
                const twoStep = indexOf(fromFile, doubleRank);
                if (fromRank === startRank && !position.board[twoStep]) {
                    moves.push(
                        createMove(position, from, twoStep, DOUBLE_PAWN),
                    );
                }
            }
        }
    }

    for (const fileDirection of [-1, 1]) {
        const toFile = fromFile + fileDirection;
        const toRank = fromRank + direction;
        if (!isOnBoard(toFile, toRank)) {
            continue;
        }

        const to = indexOf(toFile, toRank);
        const captured = position.board[to];
        if (captured && captured.color !== piece.color && captured.type !== "k") {
            if (toRank === promotionRank) {
                for (const promotion of PROMOTIONS) {
                    moves.push(
                        createMove(
                            position,
                            from,
                            to,
                            CAPTURE | PROMOTION,
                            promotion,
                        ),
                    );
                }
            } else {
                moves.push(createMove(position, from, to, CAPTURE));
            }
            continue;
        }

        if (position.enPassant !== to) {
            continue;
        }
        const capturedIndex = indexOf(toFile, fromRank);
        const passedPawn = position.board[capturedIndex];
        if (
            passedPawn?.type === "p"
            && passedPawn.color === opposite(piece.color)
        ) {
            moves.push(
                createMove(
                    position,
                    from,
                    to,
                    CAPTURE | EN_PASSANT,
                    undefined,
                    passedPawn,
                ),
            );
        }
    }
}

function addJumpMoves(
    position: ChessPosition,
    from: number,
    offsets: ReadonlyArray<readonly [number, number]>,
    moves: InternalMove[],
): void {
    const piece = position.board[from];
    if (!piece) {
        return;
    }

    for (const [fileOffset, rankOffset] of offsets) {
        const toFile = fileOf(from) + fileOffset;
        const toRank = rankOf(from) + rankOffset;
        if (!isOnBoard(toFile, toRank)) {
            continue;
        }
        const to = indexOf(toFile, toRank);
        const target = position.board[to];
        if (
            !target
            || (target.color !== piece.color && target.type !== "k")
        ) {
            moves.push(createMove(position, from, to));
        }
    }
}

function addSlidingMoves(
    position: ChessPosition,
    from: number,
    directions: ReadonlyArray<readonly [number, number]>,
    moves: InternalMove[],
): void {
    const piece = position.board[from];
    if (!piece) {
        return;
    }

    for (const [fileDirection, rankDirection] of directions) {
        let toFile = fileOf(from) + fileDirection;
        let toRank = rankOf(from) + rankDirection;
        while (isOnBoard(toFile, toRank)) {
            const to = indexOf(toFile, toRank);
            const target = position.board[to];
            if (!target) {
                moves.push(createMove(position, from, to));
            } else {
                if (target.color !== piece.color && target.type !== "k") {
                    moves.push(createMove(position, from, to));
                }
                break;
            }
            toFile += fileDirection;
            toRank += rankDirection;
        }
    }
}

function addCastlingMoves(
    position: ChessPosition,
    from: number,
    moves: InternalMove[],
): void {
    const color = position.turn;
    const homeRank = color === "w" ? 0 : 7;
    const kingHome = indexOf(4, homeRank);
    if (from !== kingHome || isInCheck(position, color)) {
        return;
    }

    const enemy = opposite(color);
    const kingSideRight = color === "w" ? "K" : "k";
    const queenSideRight = color === "w" ? "Q" : "q";
    const ownRook = (square: number) => {
        const rook = position.board[square];
        return rook?.color === color && rook.type === "r";
    };

    if (
        position.castling.includes(kingSideRight)
        && ownRook(indexOf(7, homeRank))
        && !position.board[indexOf(5, homeRank)]
        && !position.board[indexOf(6, homeRank)]
        && !isSquareAttacked(position, indexOf(5, homeRank), enemy)
        && !isSquareAttacked(position, indexOf(6, homeRank), enemy)
    ) {
        moves.push(
            createMove(position, from, indexOf(6, homeRank), KING_CASTLE),
        );
    }

    if (
        position.castling.includes(queenSideRight)
        && ownRook(indexOf(0, homeRank))
        && !position.board[indexOf(1, homeRank)]
        && !position.board[indexOf(2, homeRank)]
        && !position.board[indexOf(3, homeRank)]
        && !isSquareAttacked(position, indexOf(3, homeRank), enemy)
        && !isSquareAttacked(position, indexOf(2, homeRank), enemy)
    ) {
        moves.push(
            createMove(position, from, indexOf(2, homeRank), QUEEN_CASTLE),
        );
    }
}

function generatePseudoLegalMoves(position: ChessPosition): InternalMove[] {
    const moves: InternalMove[] = [];
    const knightOffsets: ReadonlyArray<readonly [number, number]> = [
        [1, 2],
        [2, 1],
        [2, -1],
        [1, -2],
        [-1, -2],
        [-2, -1],
        [-2, 1],
        [-1, 2],
    ];
    const diagonalDirections: ReadonlyArray<readonly [number, number]> = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ];
    const straightDirections: ReadonlyArray<readonly [number, number]> = [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
    ];
    const kingOffsets = [...diagonalDirections, ...straightDirections];

    for (let from = 0; from < 64; from += 1) {
        const piece = position.board[from];
        if (!piece || piece.color !== position.turn) {
            continue;
        }

        switch (piece.type) {
            case "p":
                addPawnMoves(position, from, moves);
                break;
            case "n":
                addJumpMoves(position, from, knightOffsets, moves);
                break;
            case "b":
                addSlidingMoves(position, from, diagonalDirections, moves);
                break;
            case "r":
                addSlidingMoves(position, from, straightDirections, moves);
                break;
            case "q":
                addSlidingMoves(position, from, kingOffsets, moves);
                break;
            case "k":
                addJumpMoves(position, from, kingOffsets, moves);
                addCastlingMoves(position, from, moves);
                break;
        }
    }

    return moves;
}

function removeCastlingRight(castling: string, right: string): string {
    return castling.replace(right, "");
}

function updateCastlingRights(
    position: ChessPosition,
    move: InternalMove,
): string {
    let rights = position.castling;
    if (move.piece.type === "k") {
        rights =
            move.piece.color === "w"
                ? removeCastlingRight(removeCastlingRight(rights, "K"), "Q")
                : removeCastlingRight(removeCastlingRight(rights, "k"), "q");
    }

    const rookRights: ReadonlyArray<readonly [number, string]> = [
        [squareToIndex("a1"), "Q"],
        [squareToIndex("h1"), "K"],
        [squareToIndex("a8"), "q"],
        [squareToIndex("h8"), "k"],
    ];
    for (const [square, right] of rookRights) {
        if (
            (move.piece.type === "r" && move.from === square)
            || (move.captured?.type === "r" && move.to === square)
        ) {
            rights = removeCastlingRight(rights, right);
        }
    }

    return rights;
}

function applyUnchecked(
    position: ChessPosition,
    move: InternalMove,
): ChessPosition {
    const board = [...position.board];
    board[move.from] = null;

    if (move.flags & EN_PASSANT) {
        const capturedSquare =
            move.to + (move.piece.color === "w" ? -8 : 8);
        board[capturedSquare] = null;
    }

    if (move.flags & KING_CASTLE) {
        const rank = move.piece.color === "w" ? 0 : 7;
        board[indexOf(5, rank)] = board[indexOf(7, rank)];
        board[indexOf(7, rank)] = null;
    } else if (move.flags & QUEEN_CASTLE) {
        const rank = move.piece.color === "w" ? 0 : 7;
        board[indexOf(3, rank)] = board[indexOf(0, rank)];
        board[indexOf(0, rank)] = null;
    }

    board[move.to] = move.promotion
        ? { color: move.piece.color, type: move.promotion }
        : move.piece;

    const isPawnMove = move.piece.type === "p";
    const isCapture = Boolean(move.flags & CAPTURE);
    return {
        board,
        turn: opposite(position.turn),
        castling: updateCastlingRights(position, move),
        enPassant:
            move.flags & DOUBLE_PAWN
                ? (move.from + move.to) / 2
                : null,
        halfmoveClock:
            isPawnMove || isCapture ? 0 : position.halfmoveClock + 1,
        fullmoveNumber:
            position.fullmoveNumber + (position.turn === "b" ? 1 : 0),
    };
}

function generateLegalInternalMoves(position: ChessPosition): InternalMove[] {
    const movingColor = position.turn;
    return generatePseudoLegalMoves(position).filter((move) => {
        const next = applyUnchecked(position, move);
        return !isInCheck(next, movingColor);
    });
}

function uciForMove(move: InternalMove): string {
    return `${indexToSquare(move.from)}${indexToSquare(move.to)}${move.promotion ?? ""}`;
}

function sanForMove(
    position: ChessPosition,
    move: InternalMove,
    legalMoves = generateLegalInternalMoves(position),
): string {
    let san = "";
    if (move.flags & KING_CASTLE) {
        san = "O-O";
    } else if (move.flags & QUEEN_CASTLE) {
        san = "O-O-O";
    } else {
        const from = indexToSquare(move.from);
        const to = indexToSquare(move.to);
        const capture = Boolean(move.flags & CAPTURE);

        if (move.piece.type === "p") {
            if (capture) {
                san += from[0];
            }
        } else {
            san += move.piece.type.toUpperCase();
            const alternatives = legalMoves.filter(
                (candidate) =>
                    candidate.from !== move.from
                    && candidate.to === move.to
                    && candidate.piece.type === move.piece.type,
            );
            if (alternatives.length > 0) {
                const sharesFile = alternatives.some(
                    (candidate) => fileOf(candidate.from) === fileOf(move.from),
                );
                const sharesRank = alternatives.some(
                    (candidate) => rankOf(candidate.from) === rankOf(move.from),
                );
                if (!sharesFile) {
                    san += from[0];
                } else if (!sharesRank) {
                    san += from[1];
                } else {
                    san += from;
                }
            }
        }

        if (capture) {
            san += "x";
        }
        san += to;
        if (move.promotion) {
            san += `=${move.promotion.toUpperCase()}`;
        }
    }

    const next = applyUnchecked(position, move);
    if (isInCheck(next, next.turn)) {
        san += generateLegalInternalMoves(next).length === 0 ? "#" : "+";
    }
    return san;
}

function toPublicMove(
    position: ChessPosition,
    move: InternalMove,
    legalMoves: InternalMove[],
): ChessLegalMove {
    return {
        uci: uciForMove(move),
        from: indexToSquare(move.from),
        to: indexToSquare(move.to),
        piece: move.piece.type,
        ...(move.promotion ? { promotion: move.promotion } : {}),
        capture: Boolean(move.flags & CAPTURE),
        ...(move.flags & KING_CASTLE
            ? { castle: "king" as const }
            : move.flags & QUEEN_CASTLE
                ? { castle: "queen" as const }
                : {}),
        san: sanForMove(position, move, legalMoves),
    };
}

function asPosition(fenOrPosition: string | ChessPosition): ChessPosition {
    return typeof fenOrPosition === "string"
        ? parseFen(fenOrPosition)
        : fenOrPosition;
}

export function getLegalMoves(
    fenOrPosition: string | ChessPosition,
): ReadonlyArray<ChessLegalMove> {
    const position = asPosition(fenOrPosition);
    const legalMoves = generateLegalInternalMoves(position);
    return legalMoves.map((move) => toPublicMove(position, move, legalMoves));
}

export function getLegalTargets(
    fenOrPosition: string | ChessPosition,
    from: string,
): ReadonlyArray<string> {
    const fromIndex = squareToIndex(from);
    const targets = generateLegalInternalMoves(asPosition(fenOrPosition))
        .filter((move) => move.from === fromIndex)
        .map((move) => indexToSquare(move.to));
    return [...new Set(targets)].sort();
}

export function positionKey(
    fenOrPosition: string | ChessPosition,
): string {
    const position = asPosition(fenOrPosition);
    const hasLegalEnPassant =
        position.enPassant !== null
        && generateLegalInternalMoves(position).some(
            (move) => Boolean(move.flags & EN_PASSANT),
        );
    return [
        boardPlacement(position),
        position.turn,
        position.castling || "-",
        hasLegalEnPassant && position.enPassant !== null
            ? indexToSquare(position.enPassant)
            : "-",
    ].join(" ");
}

export function hasInsufficientMaterial(
    fenOrPosition: string | ChessPosition,
): boolean {
    const position = asPosition(fenOrPosition);
    const material = position.board
        .map((piece, square) => ({ piece, square }))
        .filter(
            (
                entry,
            ): entry is { piece: ChessPiece; square: number } =>
                Boolean(entry.piece && entry.piece.type !== "k"),
        );

    if (material.length === 0) {
        return true;
    }
    if (
        material.length === 1
        && (material[0].piece.type === "b" || material[0].piece.type === "n")
    ) {
        return true;
    }
    if (material.every(({ piece }) => piece.type === "b")) {
        const squareColors = new Set(
            material.map(({ square }) => (fileOf(square) + rankOf(square)) % 2),
        );
        return squareColors.size === 1;
    }

    return false;
}

export function getChessOutcome(
    fenOrPosition: string | ChessPosition,
    positionHistory: ReadonlyArray<string> = [],
): ChessOutcome {
    const position = asPosition(fenOrPosition);
    const legalMoves = generateLegalInternalMoves(position);
    if (legalMoves.length === 0) {
        if (isInCheck(position, position.turn)) {
            return {
                status: "CHECKMATE",
                reason: "CHECKMATE",
                winner: opposite(position.turn),
            };
        }
        return {
            status: "DRAW",
            reason: "STALEMATE",
            winner: null,
        };
    }

    if (position.halfmoveClock >= 100) {
        return {
            status: "DRAW",
            reason: "FIFTY_MOVE",
            winner: null,
        };
    }

    const key = positionKey(position);
    const occurrences = positionHistory.filter((entry) => entry === key).length;
    if (occurrences >= 3) {
        return {
            status: "DRAW",
            reason: "THREEFOLD_REPETITION",
            winner: null,
        };
    }

    if (hasInsufficientMaterial(position)) {
        return {
            status: "DRAW",
            reason: "INSUFFICIENT_MATERIAL",
            winner: null,
        };
    }

    return {
        status: "ACTIVE",
        reason: null,
        winner: null,
    };
}

function selectLegalMove(
    position: ChessPosition,
    input: Pick<ApplyChessMoveInput, "from" | "to" | "promotion">,
): { move: InternalMove; legalMoves: InternalMove[] } {
    const from = squareToIndex(input.from);
    const to = squareToIndex(input.to);
    const legalMoves = generateLegalInternalMoves(position);
    const candidates = legalMoves.filter(
        (move) => move.from === from && move.to === to,
    );

    if (candidates.length === 0) {
        throw new Error(
            `Illegal chess move: ${input.from}${input.to}${input.promotion ?? ""}`,
        );
    }
    if (candidates.some((move) => move.promotion) && !input.promotion) {
        throw new Error("A promotion piece is required for this move");
    }
    const move = candidates.find(
        (candidate) => candidate.promotion === input.promotion,
    );
    if (!move) {
        throw new Error(
            `Illegal promotion for move: ${input.from}${input.to}${input.promotion ?? ""}`,
        );
    }

    return { move, legalMoves };
}

export function applyChessMove(
    input: ApplyChessMoveInput,
): ApplyChessMoveResult {
    const position = parseFen(input.fen);
    const { move, legalMoves } = selectLegalMove(position, input);
    const san = sanForMove(position, move, legalMoves);
    const next = applyUnchecked(position, move);
    const currentKey = positionKey(position);
    const suppliedHistory = input.positionHistory
        ? [...input.positionHistory]
        : [];
    if (
        suppliedHistory.length === 0
        || suppliedHistory[suppliedHistory.length - 1] !== currentKey
    ) {
        suppliedHistory.push(currentKey);
    }
    const nextKey = positionKey(next);
    const positionHistory = [...suppliedHistory, nextKey];
    const nextLegalMoves = generateLegalInternalMoves(next);

    return {
        fen: serializeFen(next),
        turn: next.turn,
        legalMoves: nextLegalMoves.map(uciForMove),
        outcome: getChessOutcome(next, positionHistory),
        check: isInCheck(next, next.turn),
        san,
        uci: uciForMove(move),
        positionKey: nextKey,
        positionHistory,
    };
}

export function perft(
    fenOrPosition: string | ChessPosition,
    depth: number,
): number {
    if (!Number.isInteger(depth) || depth < 0) {
        throw new Error("Perft depth must be a non-negative integer");
    }

    const position = asPosition(fenOrPosition);
    if (depth === 0) {
        return 1;
    }

    let nodes = 0;
    for (const move of generateLegalInternalMoves(position)) {
        nodes += perft(applyUnchecked(position, move), depth - 1);
    }
    return nodes;
}
