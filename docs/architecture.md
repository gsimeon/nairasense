# Architecture

## Confirmed decisions & current implementation

- Next.js + TypeScript responsive PWA with account-partitioned IndexedDB offline storage, durable pending-sync queue, and Service Worker asset caching.
- Python FastAPI backend with Argon2id password hashing, PyJWT (`HS256`) bearer authentication, per-user record ownership checks, and bounded streaming uploads.
- Hybrid inference strategy: FastAPI `local-naira-cv` experimental baseline by default (user-isolated if authenticated), optional opt-in Gemini vision provider, and in-browser `tesseract.js` receipt OCR.
- PostgreSQL is the target cloud relational database (`docker-compose.yml` + `migrations/001_initial.sql`); local prototype runtime currently uses SQLite (`nairasense_dev.db`).
- Cash totals are deterministic and based only on user-confirmed or user-corrected entries.

## Request flow

Browser PWA → HTTPS FastAPI → Auth/Rate-limit/Upload validation → Vision or OCR service → Structured response → User review & confirmation → Persisted user-isolated record (with IndexedDB offline queue).

## Important boundaries

- `local-naira-cv` is an experimental color/feature baseline, not a trained/validated Naira banknote model.
- OCR-extracted status is not independent settlement verification.
- No transfers, bank credentials, PINs or OTPs.
- No counterfeit authentication.
- Do not retain uploaded images by default.

## Remaining milestones before production

PostgreSQL + Alembic migration wiring, Redis-backed distributed rate limiting, HttpOnly cookie/refresh token session hardening, consented genuine Naira dataset training & calibration, and formal TalkBack/NVDA/VoiceOver user testing remain to be completed.
