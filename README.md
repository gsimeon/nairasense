# NairaSense

Accessible, voice-first financial information companion for blind and low-vision Nigerians.

> **Starter scaffold only.** This repository contains an initial application skeleton and mock inference implementation. It does not contain a trained Naira banknote model, production authentication, a deployed backend, a validated OCR engine, or verified accessibility/performance results.

## Confirmed architecture

- Frontend: Next.js + TypeScript, responsive PWA
- Backend: Python FastAPI
- AI: hybrid strategy; backend inference first, on-device inference evaluated later
- Database: PostgreSQL
- Local records: IndexedDB planned; not implemented in this scaffold
- First vertical slice: capture/upload one note → mock prediction → user confirmation/correction → deterministic total

## Repository layout

```text
apps/web/                 Next.js PWA starter
services/api/             FastAPI service and tests
infra/                    Local Docker Compose
docs/                     Architecture, privacy, accessibility and API notes
ai/                       Dataset protocol and model placeholder
.github/workflows/        CI starter
```

## Prerequisites

- Node.js 20+
- Python 3.11+
- Docker Desktop (optional, for PostgreSQL)
- Git

## Run the API

```powershell
cd services/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

The `/api/v1/cash/infer` endpoint currently returns a **mock** prediction. It must not be used to make real cash decisions.

## Run the web app

In another terminal:

```powershell
cd apps/web
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000

Set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1` in `.env.local`.

## Run tests

API:

```powershell
cd services/api
python -m pip install -e ".[dev]"
pytest
```

Web:

```powershell
cd apps/web
npm install
npm run lint
npm run typecheck
npm run build
```

## Validation performed for this scaffold\n\n- FastAPI test suite: 3 passed in the generation environment.\n- Python syntax compilation: passed.\n- ZIP archive integrity: passed.\n- Frontend install/build, database migrations, deployment and accessibility testing: not run.\n\n## Important implementation status

| Area | Status |
|---|---|
| Next.js application shell | Starter scaffold |
| CashSense upload/result/confirmation flow | Starter UI with mock inference |
| FastAPI health and cash inference route | Starter API; inference is mock |
| PostgreSQL schema | Initial migration draft; not applied |
| Authentication/authorisation | Not implemented |
| TransactionSense OCR | Not implemented |
| MoneyVoice spoken output | Not implemented |
| IndexedDB/offline records | Not implemented |
| Trained Naira model | Not available |
| Screen-reader user testing | Not performed |
| Deployment | Not performed |

## Safety and privacy

- Do not upload real bank statements, account credentials, PINs or OTPs to this scaffold.
- Do not interpret OCR or notification text as independent payment verification.
- Do not claim counterfeit detection.
- Do not treat the mock classifier response as an actual denomination prediction.
- Do not deploy publicly before implementing authentication, rate limiting, upload hardening, privacy controls and security review.

## First engineering milestones

1. Replace the mock classifier only after a consent-based dataset and evaluation protocol exist.
2. Add authentication before enabling server-side user records.
3. Apply and test database migrations.
4. Implement transaction extraction with field-level user review.
5. Add accessible speech output and persistent user preferences.
6. Conduct TalkBack, NVDA and VoiceOver testing with people with lived experience.
