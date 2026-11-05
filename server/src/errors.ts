// Failures the player should hear about. The error handler turns these into
// ApiError bodies; anything else is a bug and answers a generic 500.

export class HttpError extends Error {
    readonly statusCode: number;
    /** The ApiError `error` field: short and stable, for the page to branch on. */
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function notFound(message = 'Not found.'): HttpError {
    return new HttpError(404, 'not_found', message);
}

export function badRequest(message: string, code = 'bad_request'): HttpError {
    return new HttpError(400, code, message);
}
