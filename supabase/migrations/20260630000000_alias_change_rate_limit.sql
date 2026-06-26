/*
 * Rate-limit DNS (.sub / .hq / .biz) name changes to once every 365 days.
 *
 * `last_changed_at` tracks the last time a wallet *changed* its alias value.
 * It stays NULL for the auto-assigned default username given at onboarding, so a
 * user always gets one free change after signup; the first user-initiated change
 * stamps this column and starts the 365-day cooldown for every change after it.
 */
ALTER TABLE address_aliases
    ADD COLUMN IF NOT EXISTS last_changed_at TIMESTAMPTZ;
