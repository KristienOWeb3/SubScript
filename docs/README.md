# SubScript Documentation

The repository root intentionally keeps only the primary `README.md` and `LICENSE`. Supporting
material lives here, grouped by purpose.

## Product

- [Features and services](product/features-and-services.md)
- [Deployment-scoped features and backlog](product/deployment-scoped-features.md)
- [Platform feature coverage](platform-feature-coverage.md)
- [Protocol features and problems solved](subscript-protocol-features-and-problems-solved.md)
- [Vault economics](vault-economics.md)

## Architecture and operations

- [System blueprint](architecture/blueprint.md) — start here: what the pieces are, how a payment
  travels through them, and which file to open to change something
- [Strategic architecture suggestions](architecture/strategic-suggestions.md)
- [Security operations](SECOPS.md)
- [External cron jobs](external-crons.md)
- [Load testing](load-testing.md)
- [KYC verification](kyc-verification.md)
- [Bank-transfer USDC on-ramp](bank-transfer-usdc-onramp.md)

## Runbooks & Mainnet

- [Unified Mainnet Master Guide & Audit Bible](mainnet/README.md)
- [Mainnet SQL cutover migration](mainnet/mainnet-sql-cutover.sql)
- [Redeployment](redeploy-runbook.md)
- [Web Push](runbooks/web-push.md)
- [`null_api_key_plaintext` cleanup](runbooks/null_api_key_plaintext_after_hash_rollout.sql)

## Onboarding

- [Project onboarding](ONBOARDING.md)

## Archive

Historical planning material is retained for context and must not be treated as the current
product specification.

- [July 2026 handover](archive/handover-2026-07.md)
- [Merchant verification and payment-DM brainstorm](archive/merchant-verification-brainstorm.md)
