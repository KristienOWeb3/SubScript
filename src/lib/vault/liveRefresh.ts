/**
 * Commit data is mirrored to Postgres before mutation endpoints return. Keeping this interval
 * short makes changes visible across the user and merchant dashboards without polling unrelated
 * dashboard surfaces or opening a realtime database channel.
 */
export const COMMIT_LIVE_REFRESH_MS = 2_000;
