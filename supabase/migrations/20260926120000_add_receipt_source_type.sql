/*
 * Give every receipt immutable provenance so analytics cannot infer business meaning from the
 * recipient address. In particular, a peer transfer to the retired premium treasury must remain a
 * wallet transfer and must not become platform revenue.
 *
 * The Supabase CLI is not installed in this workspace, so this imperative migration follows the
 * repository's timestamp convention directly.
 */

ALTER TABLE public.receipts
    ADD COLUMN IF NOT EXISTS source_type TEXT;

/* Reliable historical joins first. */
UPDATE public.receipts AS receipt
   SET source_type = 'WALLET_TRANSFER'
 WHERE receipt.source_type IS NULL
   AND EXISTS (
       SELECT 1
         FROM public.subscript_dms AS dm
        WHERE lower(dm.tx_hash) = lower(receipt.tx_hash)
          AND dm.message_type = 'PEER_TRANSFER'
   );

UPDATE public.receipts AS receipt
   SET source_type = 'RETIRED_PREMIUM'
 WHERE receipt.source_type IS NULL
   AND EXISTS (
       SELECT 1
         FROM public.payment_sessions AS session
        WHERE lower(session.tx_hash) = lower(receipt.tx_hash)
          AND session.status = 'COMPLETED'
   );

UPDATE public.receipts AS receipt
   SET source_type = 'SUBSCRIPTION'
 WHERE receipt.source_type IS NULL
   AND EXISTS (
       SELECT 1
         FROM public.subscriptions AS subscription
        WHERE lower(subscription.payment_tx_hash) = lower(receipt.tx_hash)
          AND subscription.kind = 'CUSTOMER'
   );

/* The three direct-send writers used these exact default titles before provenance existed. The DM
 * join above catches custom-titled transfers; these values cover sends recorded without a DM row. */
UPDATE public.receipts
   SET source_type = 'WALLET_TRANSFER'
 WHERE source_type IS NULL
   AND title IN ('Wallet Transfer', 'USDC Transfer');

UPDATE public.receipts
   SET source_type = 'COMMERCE_PAYMENT'
 WHERE source_type IS NULL;

ALTER TABLE public.receipts
    ALTER COLUMN source_type SET DEFAULT 'COMMERCE_PAYMENT',
    ALTER COLUMN source_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'receipts_source_type_check'
           AND conrelid = 'public.receipts'::regclass
    ) THEN
        ALTER TABLE public.receipts
            ADD CONSTRAINT receipts_source_type_check
            CHECK (source_type IN (
                'COMMERCE_PAYMENT',
                'SUBSCRIPTION',
                'WALLET_TRANSFER',
                'RETIRED_PREMIUM'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS receipts_source_status_confirmed_idx
    ON public.receipts (source_type, status, confirmed_at DESC);
