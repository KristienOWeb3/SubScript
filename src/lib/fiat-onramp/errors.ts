export class FiatOnrampError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = "FiatOnrampError";
    }
}

export function badRequest(message: string, code = "INVALID_REQUEST") {
    return new FiatOnrampError(message, 400, code);
}

export function conflict(message: string, code = "CONFLICT") {
    return new FiatOnrampError(message, 409, code);
}

export function notFound(message = "Funding intent not found") {
    return new FiatOnrampError(message, 404, "NOT_FOUND");
}

export function unavailable(message: string) {
    return new FiatOnrampError(message, 503, "FIAT_ONRAMP_UNAVAILABLE");
}

export function tooManyRequests(message: string) {
    return new FiatOnrampError(message, 429, "RATE_LIMITED");
}
