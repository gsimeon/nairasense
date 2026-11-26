# NairaSense

Accessible, voice-first financial information companion for blind and low-vision Nigerians.

> **Prototype stage — not production-ready.** NairaSense implements live camera capture, an experimental offline pixel-based banknote classifier (`local-naira-cv`), browser-based receipt OCR (`tesseract.js`), spoken feedback (`MoneyVoice`), IndexedDB offline storage, and a FastAPI backend. It does **not** yet have a trained/validated Naira banknote vision model, multi-user authentication, PostgreSQL runtime persistence, or a formal screen-reader accessibility audit.

## Architecture (current vs. target)

- **Frontend:** Next.js 14 + TypeScript PWA (`apps/web`), IndexedDB offline storage, Service Worker asset caching, Web Speech API (`MoneyVoice`), Web Audio chimes/haptics, optional Speech Recognition voice commands, and `tesseract.js` in-browser OCR.
- **Backend:** Python FastAPI (`services/api`) with `Pillow` + `NumPy` offline feature-based banknote baseline (`local-naira-cv`), optional `gemini-2.5-flash` vision provider, deterministic transaction text extraction, and preferences API.
- **Database:** Local SQLite (`nairasense_dev.db`) is used for local prototype persistence. A PostgreSQL Docker setup (`docker-compose.yml`) and initial SQL schema (`services/api/migrations/001_initial.sql`) exist for the target cloud deployment but are not yet wired into the FastAPI runtime.
- **AI & Offline Reality:** Banknote inference runs on the FastAPI backend (`local-naira-cv` by default, no API key required). Browser assets, confirmed cash/transaction records, and receipt OCR work offline, while banknote inference requires connectivity to the FastAPI service.

## Implementation status

| Area | Current Status |
|---|---|
| CashSense live camera + photo capture | Implemented (with brightness/blur checks & user confirmation) |
| Banknote recognition (`local-naira-cv`) | Experimental HSV/spatial color baseline; **not** a trained/validated vision model |
| TransactionSense | OCR-assisted extraction (`tesseract.js` + regex) with field-level user review |
| MoneyVoice & accessibility controls | Web Speech synthesis, repeat/stop, chimes/haptics, text size, high contrast |
| IndexedDB & Service Worker | Implemented for local records, preferences, and static asset caching |
| Authentication & user isolation | Implemented (`Argon2id` + `PyJWT` HS256); per-user ownership on sessions, transactions, and preferences |
| Upload & inference hardening | `/cash/infer` is rate-limited anonymous triage with 8 MB bounded streaming reads, magic-byte checks, and 12 MP pixel caps |
| PostgreSQL integration | Schema & Docker Compose drafted; runtime currently uses SQLite |
| Screen-reader audit (TalkBack/NVDA/VoiceOver) | **Not yet performed** |

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

## Validation & important limitations

- **Backend:** `ruff check app tests` and `pytest` (11 tests covering health, cash sessions, local baseline classifier, opt-in enrollment guard, transaction extraction/CRUD, and preferences).
- **Frontend:** `npm run typecheck`, `npm run lint`, and `npm run build`.
- **Important:** API tests use synthetic textured PNGs, not genuine Naira banknote photographs. Do not treat baseline match scores as calibrated accuracy.

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
