/*
 * Output contract for machine consumers (AI agents, CI):
 *   - Human-readable progress always goes to stderr in --json mode, so stdout carries exactly
 *     one parseable JSON object: { ok, command, files_written, ... } or { ok: false, error }.
 *   - Every failure path exits non-zero with the error on stderr and the fix on the next line.
 */

let jsonMode = false;
let currentCommand = "unknown";
const filesWritten: string[] = [];

export function setJsonMode(enabled: boolean, command: string) {
    jsonMode = enabled;
    currentCommand = command;
}

export function isJsonMode(): boolean {
    return jsonMode;
}

/** Progress/info output. Routed to stderr in --json mode so stdout stays machine-parseable. */
export function log(message: string) {
    if (jsonMode) console.error(message);
    else console.log(message);
}

export function warn(message: string) {
    console.error(message);
}

export function recordFile(relativePath: string) {
    filesWritten.push(relativePath.replace(/\\/g, "/"));
}

export function getFilesWritten(): string[] {
    return [...filesWritten];
}

export interface SuccessExtra {
    [key: string]: unknown;
}

/** Emit the single success JSON object (in --json mode) and return. Exit code stays 0. */
export function emitSuccess(extra: SuccessExtra = {}) {
    if (jsonMode) {
        console.log(JSON.stringify({
            ok: true,
            command: currentCommand,
            files_written: getFilesWritten(),
            ...extra,
        }, null, 2));
    }
}

export interface FailOptions {
    code: string;
    message: string;
    fix?: string;
    extra?: Record<string, unknown>;
}

/** Report a failure (stderr message + fix, or JSON envelope on stdout) and exit non-zero. */
export function fail(options: FailOptions): never {
    if (jsonMode) {
        console.error(`[ERROR] ${options.message}`);
        if (options.fix) console.error(`   Fix: ${options.fix}`);
        console.log(JSON.stringify({
            ok: false,
            command: currentCommand,
            files_written: getFilesWritten(),
            error: {
                code: options.code,
                message: options.message,
                ...(options.fix ? { fix: options.fix } : {}),
            },
            ...(options.extra ?? {}),
        }, null, 2));
    } else {
        console.error(`[ERROR] ${options.message}`);
        if (options.fix) console.error(`   Fix: ${options.fix}`);
    }
    process.exit(1);
}
