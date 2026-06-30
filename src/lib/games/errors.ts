export class DmGameError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = "DmGameError";
    }
}

export const gameBadRequest = (message: string, code = "INVALID_GAME_REQUEST") =>
    new DmGameError(message, 400, code);

export const gameUnauthorized = (message = "Unauthorized") =>
    new DmGameError(message, 401, "UNAUTHORIZED");

export const gameForbidden = (message: string, code = "FORBIDDEN") =>
    new DmGameError(message, 403, code);

export const gameNotFound = (message = "Game not found") =>
    new DmGameError(message, 404, "GAME_NOT_FOUND");

export const gameConflict = (message: string, code = "GAME_CONFLICT") =>
    new DmGameError(message, 409, code);

export const gameUnavailable = (message: string) =>
    new DmGameError(message, 503, "DM_GAMES_UNAVAILABLE");

export const gameRateLimited = () =>
    new DmGameError("Too many game requests. Try again later.", 429, "RATE_LIMITED");

