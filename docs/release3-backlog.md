# NairaSense Release 3 — Reliability and Accessibility Validation Backlog

This backlog operationalizes the four Release 3 milestones without rewriting the existing Next.js PWA + FastAPI + IndexedDB architecture.

---

## Sprint 1 — Parser and Data Integrity (`P0`, Completed in Repo)

| ID | Item | Repository Targets | Acceptance Criteria | Test Cases |
| --- | --- | --- | --- | --- |
| R3-S1-1 | Separate `transaction_direction` from `reported_status` and `user_confirmed` | `services/api/app/services/transaction_parser.py`, `apps/web/src/components/TransactionSensePanel.tsx` | `Debit`/`Credit` never override outcome (`Successful`, `Pending`, `Failed`, `Reversed`, `Ambiguous (Review Required)`); `user_confirmed` is tracked separately from `reported_status`. | `test_direction_does_not_override_outcome`, `test_transaction_crud_lifecycle` |
| R3-S1-2 | Negation and multi-event fixture coverage | `services/api/tests/fixtures/transaction_messages/nigerian_alerts.json`, `apps/web/src/lib/offlineParser.ts` | Handles `"not successful"`, `"unsuccessful"`, `"not reversed"`, `"reversal failed"`, `"refund pending"`, `"refund completed"`, and conflicting multi-event messages. | `test_nigerian_bank_message_fixtures` |
| R3-S1-3 | Enforce online/offline parser parity on shared fixtures | `apps/web/e2e/nairasense.spec.ts`, `apps/web/src/lib/offlineParser.ts` | Automated E2E test runs every fixture in `nigerian_alerts.json` through both `/api/v1/transactions/extract` and `parseLocallyOffline` and asserts identical outputs. | `Online and offline parsers match across all shared Nigerian bank fixtures` |
| R3-S1-4 | Screen-reader alert on ambiguous outcomes & sync-status accuracy | `apps/web/src/components/TransactionSensePanel.tsx`, `apps/web/src/components/SyncStatusPanel.tsx`, `apps/web/src/app/page.tsx` | Conflicting outcomes render `role="alert"` review banner; `lastSyncedAt === null` never claims `"Your record has synchronised"`. | Playwright E2E suite |

**Dependencies:** None.

---

## Sprint 2 — Accessibility Validation (`P1`)

| ID | Item | Repository / Process Targets | Acceptance Criteria | Test Cases / Evidence |
| --- | --- | --- | --- | --- |
| R3-S2-1 | Supervised TalkBack (Android Chrome) & NVDA (Windows Chrome/Edge) task testing | `ACCESSIBILITY.md`, `apps/web/src/components/CashSensePanel.tsx`, `apps/web/src/components/TransactionSensePanel.tsx` | Blind and low-vision Nigerian participants (with informed consent and compensation) complete: (a) capture/upload one note, (b) confirm/correct/reject prediction, (c) hear updated total, (d) review a multi-amount transaction, (e) recover from offline mode. | Recorded task-completion log & usability findings |
| R3-S2-2 | VoiceOver (iOS Safari) & MoneyVoice language validation | `apps/web/src/lib/voice.ts`, `apps/web/src/components/PreferencesPanel.tsx` | Fluent speakers verify Yorùbá, Hausa, Igbo, Nigerian Pidgin, and English spoken templates; keyboard-only & screen-reader flows work without speech recognition. | Participant sign-off & defect log |
| R3-S2-3 | Remediate critical usability barriers before feature expansion | `apps/web/src/components/*` | All P0/P1 screen-reader focus, live-region duplication, or control-labeling barriers resolved and re-tested. | Updated `ACCESSIBILITY.md` audit summary |

**Dependencies:** Sprint 1 complete; participant recruitment & consent protocol.

---

## Sprint 3 — Data and Backend Reliability (`P1`)

| ID | Item | Repository Targets | Acceptance Criteria | Test Cases |
| --- | --- | --- | --- | --- |
| R3-S3-1 | PostgreSQL runtime & Alembic migrations | `services/api/app/db.py`, `services/api/alembic/` (new), `services/api/pyproject.toml` | FastAPI runs against PostgreSQL with Alembic migrations, foreign-key constraints, unique `(user_id, idempotency_key)` indexes, and tested rollback/recovery. | CI PostgreSQL integration job |
| R3-S3-2 | Shared rate limiting & session/account lifecycle | `services/api/app/routes/auth.py`, `services/api/app/auth.py` | Replace in-memory rate limiter with Redis (or shared store) for multi-instance deployment; add session revocation, account deletion, and cookie/CSRF evaluation. | Auth lifecycle & rate-limit tests |
| R3-S3-3 | Concurrency-safe enrollment sample persistence | `services/api/app/services/local_vision.py` | Replace JSON-file reference-sample store with database-backed per-user storage, consent/retention metadata, and deletion cascade before enabling enrollment in production. | Enrollment isolation & deletion tests |

**Dependencies:** Sprint 1 complete; Sprint 2 findings prioritized.

---

## Sprint 4 — Recognition Evaluation (`P2`)

| ID | Item | Repository / Research Targets | Acceptance Criteria | Test Cases / Metrics |
| --- | --- | --- | --- | --- |
| R3-S4-1 | Consent-based Naira banknote dataset | Dataset collection protocol (outside app runtime) | Covers all 8 denominations (`₦5`–`₦1000`), front/back, new/worn/folded notes, varied lighting/backgrounds/cameras, split strictly by physical note and collection session. | Dataset manifest & split verification |
| R3-S4-2 | Reproducible baseline & model evaluation | `services/api/app/services/local_vision.py` + evaluation script | Measure per-denomination precision, recall, macro F1, confusion matrix, abstention rate, image rejection rate, latency, and confidence calibration. | Benchmark report before claiming accuracy |
| R3-S4-3 | Calibrated abstention & model comparison | Inference provider abstraction | Trained model replaces heuristic baseline only if it outperforms it on held-out physical notes with safe abstention on uncertain inputs. | Evaluation gate sign-off |

**Dependencies:** Informed-consent protocol and physical banknote capture sessions.
