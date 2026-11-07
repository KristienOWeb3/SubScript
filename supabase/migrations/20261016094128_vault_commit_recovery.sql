-- No legacy backfill: updated_at is not confirmation evidence, and old manual
-- mainnet intents were incorrectly labelled TEST. Preserve unknown provenance.
ALTER TABLE public.vault_commit_intents
  ADD COLUMN chain_id BIGINT CHECK (chain_id > 0),
  ADD COLUMN contract_address TEXT CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN receipt_job_id TEXT,
  ADD COLUMN approval_provider_id TEXT,
  ADD COLUMN commit_provider_id TEXT,
  ADD COLUMN request_started_at TIMESTAMPTZ,
  ADD COLUMN preflight_completed_at TIMESTAMPTZ,
  ADD COLUMN approval_submitted_at TIMESTAMPTZ,
  ADD COLUMN approval_confirmed_at TIMESTAMPTZ,
  ADD COLUMN submission_started_at TIMESTAMPTZ,
  ADD COLUMN submitted_at TIMESTAMPTZ,
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN mirrored_at TIMESTAMPTZ;

CREATE INDEX vault_commit_intents_recovery_idx
  ON public.vault_commit_intents(environment, chain_id, created_at)
  WHERE status IN ('PENDING', 'SUBMITTED');

CREATE OR REPLACE FUNCTION public.enforce_vault_commit_intent_terminal_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status IN ('MIRRORED', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'vault commit intent terminal state cannot be reopened';
  END IF;
  IF ROW(NEW.request_id, NEW.user_address, NEW.merchant_address, NEW.amount_usdc,
         NEW.environment, NEW.custody_idempotency_key, NEW.chain_id, NEW.contract_address)
     IS DISTINCT FROM
     ROW(OLD.request_id, OLD.user_address, OLD.merchant_address, OLD.amount_usdc,
         OLD.environment, OLD.custody_idempotency_key, OLD.chain_id, OLD.contract_address) THEN
    RAISE EXCEPTION 'vault commit intent identity cannot change';
  END IF;
  IF (OLD.approval_provider_id IS NOT NULL AND NEW.approval_provider_id IS DISTINCT FROM OLD.approval_provider_id)
     OR (OLD.commit_provider_id IS NOT NULL AND NEW.commit_provider_id IS DISTINCT FROM OLD.commit_provider_id)
     OR (OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash) THEN
    RAISE EXCEPTION 'vault commit intent accepted identity cannot change';
  END IF;
  RETURN NEW;
END;
$$;
