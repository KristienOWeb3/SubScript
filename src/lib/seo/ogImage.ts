/* Social preview image. Telegram, Slack and others cache link previews by image URL, so when
   public/og.png changes, bump OG_IMAGE_VERSION (first 8 chars of its md5) to force a re-fetch.
   The og-image test fails if the two drift. */
export const OG_IMAGE_VERSION = "db70f63d";
export const OG_IMAGE_PATH = `/og.png?v=${OG_IMAGE_VERSION}`;
