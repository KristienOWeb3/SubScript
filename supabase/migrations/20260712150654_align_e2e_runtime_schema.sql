/* Keep fresh Supabase stacks aligned with the Prisma Receipt model used by the private-receipt
 * API and its delegation tests. Production already had this field through an out-of-band schema
 * change; ADD IF NOT EXISTS makes the alignment safe everywhere. */
ALTER TABLE public.receipts
    ADD COLUMN IF NOT EXISTS invited_addresses TEXT NOT NULL DEFAULT '';
