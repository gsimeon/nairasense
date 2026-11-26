# API contract (starter)

Base path: `/api/v1`

| Method | Path | Current state |
|---|---|---|
| GET | `/health` | Implemented starter |
| GET | `/ready` | Placeholder |
| POST | `/cash/infer` | Implemented mock only |

Planned endpoints:
- `POST /cash/sessions`
- `GET /cash/sessions/{id}`
- `POST /cash/sessions/{id}/entries`
- `DELETE /cash/entries/{id}`
- `POST /transactions/extract`
- `POST /transactions`
- `GET /transactions`
- `PATCH /transactions/{id}`
- `DELETE /transactions/{id}`
- `GET /preferences`
- `PUT /preferences`

All user-specific endpoints require authentication and ownership checks before production.
