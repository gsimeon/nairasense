# Architecture

## Confirmed decisions

- Next.js + TypeScript responsive PWA.
- Python FastAPI backend.
- Hybrid inference strategy: backend first; evaluate ONNX Runtime Web later.
- PostgreSQL is the proposed cloud relational database.
- Cash totals are deterministic and based only on user-confirmed entries.

## Request flow

Browser PWA → HTTPS FastAPI → validation/business rules → vision or OCR service → structured response → user review → persisted confirmed record.

## Important boundaries

- Mock inference is not a real classifier.
- OCR-extracted status is not independent settlement verification.
- No transfers, bank credentials, PINs or OTPs.
- No counterfeit authentication.
- Do not retain uploaded images by default.

## Future work

Authentication, database repositories, migrations, model registry, OCR benchmark, local inference experiment, observability and deployment hardening remain unimplemented.
