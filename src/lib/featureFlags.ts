/* Shared runtime feature flags — single definition so pages can't drift.
 *
 * Circle Google social sign-in is disabled server-side (the completion endpoint returns 503 until
 * identity is verified against a single-use challenge), so the button stays hidden unless a
 * deployment explicitly opts in. Advertising a button that always fails erodes trust.
 */
export const CIRCLE_GOOGLE_ENABLED = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED === "true";
