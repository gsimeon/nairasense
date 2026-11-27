# NairaSense Release 3.3 — Core Reliability and Accessibility Validation Backlog

This backlog operationalizes the Release 3.3 milestones without rewriting the existing Next.js PWA + FastAPI + IndexedDB + SQLite local-dev architecture.

---

## Sprint 1 — Transaction Integrity (`P0`, Completed in Repo)

| ID | Item | Repository Targets | Acceptance Criteria | Test Cases |
| --- | --- | --- | --- | --- |
| NS-331 | Enforce amount candidate consistency on the backend | `services/api/app/schemas/transactions.py`, `services/api/app/routes/transactions.py`, `apps/web/src/components/TransactionSensePanel.tsx` | Selected `selected_candidate_id` must exist in `labeled_amounts`; `amount_kobo` and `selected_candidate_context` must match; fabricated/mismatched candidates rejected (`422`); manual (`amount_entry_mode="manual"`) and unknown (`amount_entry_mode="unknown"`) amounts remain valid. | `test_ambiguous_date_requires_confirmation_on_create`, E2E repeated-amount & manual/unknown tests |
| NS-332 | Strengthen transaction date validation | `services/api/app/routes/transactions.py`, `services/api/app/services/transaction_parser.py`, `apps/web/src/lib/offlineParser.ts`, `apps/web/src/components/TransactionSensePanel.tsx` | Impossible calendar dates (e.g. `31/02/2026`) and invalid times/ISO offsets rejected; ambiguous numeric dates (`03/04/2026`) require explicit confirmation or clearing; manual edits reset stale confirmation; original `extracted_transaction_date` preserved. | `test_ambiguous_date_requires_confirmation_on_create`, `test_nigerian_bank_message_fixtures`, E2E date confirmation & reset tests |
| NS-333 | Expand transaction integrity regression tests | `services/api/tests/fixtures/transaction_messages/nigerian_alerts.json`, `services/api/tests/test_transactions.py`, `apps/web/e2e/nairasense.spec.ts` | Independent expected values for all fixtures (multi-amount, repeated identical amounts, balance-only, fee-only, negated/conflicting outcomes, ISO 8601 timezones); both parsers tested against independent expected values. | `test_nigerian_bank_message_fixtures`, `Online and offline parsers match across all shared Nigerian bank fixtures and alert on ambiguity` |

**Dependencies:** None.

---

## Sprint 2 — Accessibility Validation (`P0`)

| ID | Item | Repository / Process Targets | Acceptance Criteria |
| --- | --- | --- | --- |
| NS-334 | Conduct supervised accessibility testing | `ACCESSIBILITY.md` | Informed-consent testing with blind/low-vision Nigerian participants (TalkBack on Android first, then NVDA and VoiceOver) across all 10 core scenarios; task completion, errors, and barriers logged; no WCAG claim without audit. |
| NS-335 | Improve screen-reader and keyboard interaction | `apps/web/src/components/CashSensePanel.tsx`, `TransactionSensePanel.tsx`, `SyncStatusPanel.tsx`, `apps/web/src/app/page.tsx` | All essential actions accessible by keyboard and screen reader; predictable focus management; errors/sync/recognition results announced clearly; speech stop/repeat and visible non-speech controls. |

**Dependencies:** Sprint 1 complete (`NS-331`–`NS-333`).

---

## Sprint 3 — CashSense Dataset and Evaluation (`P1`)

| ID | Item | Repository / Research Targets | Acceptance Criteria |
| --- | --- | --- | --- |
| NS-336 | Establish a consented Naira banknote dataset | Dataset collection protocol | All 8 denominations (`₦5`–`₦1000`), front/back, new/worn notes, varied lighting/backgrounds/cameras; split strictly by physical note and collection session; provenance & consent documented. |
| NS-337 | Establish a banknote recognition evaluation baseline | `services/api/app/services/local_vision.py` + evaluation script | Reproducible per-denomination precision, recall, macro F1, confusion matrix, high-confidence error rate, abstention rate, image rejection rate, latency, and calibration. |

**Dependencies:** Informed-consent protocol and physical banknote capture sessions.

---

## Sprint 4 — Backend Operational Reliability (`P1`)

| ID | Item | Repository Targets | Acceptance Criteria |
| --- | --- | --- | --- |
| NS-338 | Prepare PostgreSQL migration without disrupting SQLite development | `services/api/app/db.py`, Alembic migrations | PostgreSQL schema created from Alembic migrations; core API & account-isolation tests pass on PostgreSQL; rollback documented; production does not silently fall back to SQLite. |
| NS-339 | Improve user sample persistence and rate limiting | `services/api/app/services/local_vision.py`, `services/api/app/rate_limit.py` | Atomic/durable per-user sample persistence with ownership and deletion; shared rate limiting (e.g. Redis) documented/enabled for multi-instance deployment. |

**Dependencies:** Sprint 1 complete.

---

## Sprint 5 — Security and Production Preparation (`P2`)

| ID | Item | Repository Targets | Acceptance Criteria |
| --- | --- | --- | --- |
| NS-340 | Review authentication and local data protection | `apps/web/src/lib/api.ts`, `storage.ts`, `services/api/app/auth.py` | Auth lifecycle documented; logout/account-switch clears state; token storage & unencrypted IndexedDB risks addressed; no secrets committed. |
| NS-341 | Create a controlled pilot readiness checklist | `README.md`, `docs/` | Supported browsers/AT, backup/recovery tests, health/readiness endpoints, incident response, rollback procedure, and pilot limitations documented. |
