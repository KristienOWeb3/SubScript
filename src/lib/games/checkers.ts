export const CHECKERS_INITIAL_FEN = "b1b1b1b1/1b1b1b1b/b1b1b1b1/8/8/1w1w1w1w/w1w1w1w1/1w1w1w1w w";

export type CheckersColor = "w" | "b";
export type CheckersPieceType = "p" | "k"; // pawn (man) or king

export interface CheckersPiece {
    readonly color: CheckersColor;
    readonly type: CheckersPieceType;
}

export interface CheckersPosition {
    readonly board: ReadonlyArray<CheckersPiece | null>;
    readonly turn: CheckersColor;
}

export interface CheckersMove {
    readonly from: string;
    readonly to: string;
    readonly isJump: boolean;
    readonly jumpedCoords: { readonly file: number; readonly rank: number } | null;
}

export interface ApplyCheckersMoveResult {
    readonly fen: string;
    readonly turn: CheckersColor;
    readonly uci: string;
    readonly san: string;
    readonly status: "ACTIVE" | "WHITE_WON" | "BLACK_WON" | "DRAW";
    readonly winner: CheckersColor | null;
    readonly reason: string | null;
}

function squareToCoords(square: string) {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    return { file, rank };
}

function coordsToSquare(file: number, rank: number) {
    return String.fromCharCode(97 + file) + (rank + 1);
}

export function parseFen(fen: string): CheckersPosition {
    const parts = fen.trim().split(" ");
    const boardPart = parts[0];
    const turn = (parts[1] || "w") as CheckersColor;

    const board: (CheckersPiece | null)[] = Array(64).fill(null);
    const rows = boardPart.split("/");

    for (let r = 0; r < 8; r++) {
        const rowStr = rows[r] || "8";
        const rank = 7 - r; // index 7 to 0
        let file = 0;

        for (let i = 0; i < rowStr.length; i++) {
            const char = rowStr[i];
            if (char >= "1" && char <= "8") {
                file += parseInt(char, 10);
            } else {
                const color = char.toLowerCase() === "w" ? "w" : "b";
                const type = char === char.toUpperCase() ? "k" : "p";
                board[rank * 8 + file] = { color, type };
                file++;
            }
        }
    }

    return { board, turn };
}

export function serializeFen(board: ReadonlyArray<CheckersPiece | null>, nextTurn: CheckersColor): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
        let rowStr = "";
        let emptyCount = 0;
        for (let f = 0; f < 8; f++) {
            const piece = board[r * 8 + f];
            if (piece === null) {
                emptyCount++;
            } else {
                if (emptyCount > 0) {
                    rowStr += emptyCount.toString();
                    emptyCount = 0;
                }
                const char = piece.type === "k" ? piece.color.toUpperCase() : piece.color;
                rowStr += char;
            }
        }
        if (emptyCount > 0) {
            rowStr += emptyCount.toString();
        }
        rows.push(rowStr);
    }
    return rows.join("/") + " " + nextTurn;
}

export function getLegalTargets(fen: string, square: string): string[] {
    const { board, turn } = parseFen(fen);
    const { file, rank } = squareToCoords(square);
    const piece = board[rank * 8 + file];
    if (!piece || piece.color !== turn) return [];

    // Check if the current player has ANY jumps available on the board
    let playerHasJumps = false;
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const p = board[r * 8 + f];
            if (p && p.color === turn) {
                const jumps = getMovesForPiece(board, f, r, turn, true);
                if (jumps.length > 0) {
                    playerHasJumps = true;
                    break;
                }
            }
        }
        if (playerHasJumps) break;
    }

    const moves = getMovesForPiece(board, file, rank, turn, playerHasJumps);
    return moves.map(m => m.to);
}

function getMovesForPiece(
    board: ReadonlyArray<CheckersPiece | null>,
    file: number,
    rank: number,
    turn: CheckersColor,
    jumpsOnly: boolean
): CheckersMove[] {
    const piece = board[rank * 8 + file];
    if (!piece) return [];

    const moves: CheckersMove[] = [];
    const isKing = piece.type === "k";

    // Determine movement directions
    const directions: { dx: number; dy: number }[] = [];
    if (isKing) {
        directions.push({ dx: -1, dy: 1 });
        directions.push({ dx: 1, dy: 1 });
        directions.push({ dx: -1, dy: -1 });
        directions.push({ dx: 1, dy: -1 });
    } else {
        const dy = piece.color === "w" ? 1 : -1;
        directions.push({ dx: -1, dy });
        directions.push({ dx: 1, dy });
    }

    const fromSquare = coordsToSquare(file, rank);

    for (const dir of directions) {
        // 1. Standard moves (only check if jumpsOnly is false)
        if (!jumpsOnly) {
            const targetFile = file + dir.dx;
            const targetRank = rank + dir.dy;
            if (targetFile >= 0 && targetFile < 8 && targetRank >= 0 && targetRank < 8) {
                if (board[targetRank * 8 + targetFile] === null) {
                    moves.push({
                        from: fromSquare,
                        to: coordsToSquare(targetFile, targetRank),
                        isJump: false,
                        jumpedCoords: null
                    });
                }
            }
        }

        // 2. Jump/Capture moves
        const midFile = file + dir.dx;
        const midRank = rank + dir.dy;
        const targetFile = file + dir.dx * 2;
        const targetRank = rank + dir.dy * 2;

        if (targetFile >= 0 && targetFile < 8 && targetRank >= 0 && targetRank < 8) {
            const midPiece = board[midRank * 8 + midFile];
            const targetPiece = board[targetRank * 8 + targetFile];

            if (midPiece && midPiece.color !== turn && targetPiece === null) {
                moves.push({
                    from: fromSquare,
                    to: coordsToSquare(targetFile, targetRank),
                    isJump: true,
                    jumpedCoords: { file: midFile, rank: midRank }
                });
            }
        }
    }

    return moves;
}

export function applyCheckersMove(input: {
    fen: string;
    from: string;
    to: string;
    positionHistory: string[];
}): ApplyCheckersMoveResult {
    const { board, turn } = parseFen(input.fen);
    const fromCoords = squareToCoords(input.from);
    const toCoords = squareToCoords(input.to);

    const fromIdx = fromCoords.rank * 8 + fromCoords.file;
    const toIdx = toCoords.rank * 8 + toCoords.file;

    const piece = board[fromIdx];
    if (!piece) throw new Error("No piece at starting square");

    // Respect mandatory jump priority
    let playerHasJumps = false;
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const p = board[r * 8 + f];
            if (p && p.color === turn) {
                const jumps = getMovesForPiece(board, f, r, turn, true);
                if (jumps.length > 0) {
                    playerHasJumps = true;
                    break;
                }
            }
        }
        if (playerHasJumps) break;
    }

    const validMoves = getMovesForPiece(board, fromCoords.file, fromCoords.rank, turn, playerHasJumps);
    const matchingMove = validMoves.find(m => m.to === input.to);
    if (!matchingMove) {
        throw new Error("Illegal checkers move");
    }

    const mutableBoard = [...board];

    // Execute the move
    mutableBoard[toIdx] = piece;
    mutableBoard[fromIdx] = null;

    // Promotion check
    if (piece.color === "w" && toCoords.rank === 7) {
        mutableBoard[toIdx] = { color: "w", type: "k" };
    } else if (piece.color === "b" && toCoords.rank === 0) {
        mutableBoard[toIdx] = { color: "b", type: "k" };
    }

    // Capture check
    if (matchingMove.isJump && matchingMove.jumpedCoords) {
        const jumpIdx = matchingMove.jumpedCoords.rank * 8 + matchingMove.jumpedCoords.file;
        mutableBoard[jumpIdx] = null;
    }

    // Change turn
    const nextTurn = turn === "w" ? "b" : "w";
    const nextFen = serializeFen(mutableBoard, nextTurn);

    // Determine status / outcome
    let status: "ACTIVE" | "WHITE_WON" | "BLACK_WON" | "DRAW" = "ACTIVE";
    let winner: CheckersColor | null = null;
    let reason: string | null = null;

    // Check if opponent has any legal moves left
    let opponentHasMoves = false;
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const p = mutableBoard[r * 8 + f];
            if (p && p.color === nextTurn) {
                const moves = getMovesForPiece(mutableBoard, f, r, nextTurn, false);
                if (moves.length > 0) {
                    opponentHasMoves = true;
                    break;
                }
            }
        }
        if (opponentHasMoves) break;
    }

    if (!opponentHasMoves) {
        status = turn === "w" ? "WHITE_WON" : "BLACK_WON";
        winner = turn;
        reason = "ELIMINATION";
    }

    const uci = `${input.from}${input.to}`;
    const san = matchingMove.isJump ? `${input.from}x${input.to}` : `${input.from}-${input.to}`;

    return {
        fen: nextFen,
        turn: nextTurn,
        uci,
        san,
        status,
        winner,
        reason
    };
}
