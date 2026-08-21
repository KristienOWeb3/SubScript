/* Shared validation for stored profile pictures.
 *
 * These lived privately inside src/app/api/user/settings/route.ts, which meant the write path
 * validated avatars and every read path except that route's own GET did not. The DM inbox in
 * particular handed whatever was in the column straight to <img src>, so a legacy unsafe row or
 * an empty string reached the browser untouched. One module, imported by both sides. */

/* A profile picture may only be a raster image upload (data URL) or an https URL.
   This blocks javascript:/data:text-html/svg payloads that would otherwise be stored
   verbatim and become an XSS or SSRF vector when the avatar is rendered. */
const PROFILE_PIC_DATA_URL_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSafeProfilePicValue(value: string): boolean {
    if (value.length > 5_000_000) return false;
    if (value.startsWith("data:")) {
        // Validate the whole data URL (incl. base64 body), not just the prefix — an empty
        // "data:image/png;base64," passes a prefix check but uploadProfilePicture rejects it.
        return PROFILE_PIC_DATA_URL_RE.test(value);
    }
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}

/* Sanitize a stored avatar before returning it, so legacy unsafe rows (javascript:, svg data
   URLs, empty strings) can't reach the client until they're overwritten with a safe value. */
export function safeProfilePicOrNull(value: string | null | undefined): string | null {
    return value && isSafeProfilePicValue(value) ? value : null;
}
