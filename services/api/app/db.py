import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.settings import settings

DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"
VALID_DENOMINATIONS = (5, 10, 20, 50, 100, 200, 500, 1000)

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cash_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'NGN',
    created_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS cash_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    predicted_denomination INTEGER,
    confirmed_denomination INTEGER,
    confidence REAL,
    confirmation_status TEXT NOT NULL CHECK (
        confirmation_status IN ('pending', 'confirmed', 'corrected', 'rejected')
    ),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_entries_session ON cash_entries(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS transaction_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_kobo INTEGER CHECK (amount_kobo IS NULL OR amount_kobo >= 0),
    currency TEXT NOT NULL DEFAULT 'NGN',
    transaction_date TEXT,
    reference TEXT,
    sender_label TEXT,
    recipient_label TEXT,
    reported_status TEXT,
    source_type TEXT NOT NULL CHECK (
        source_type IN ('notification', 'receipt', 'pasted_text', 'other')
    ),
    extracted_fields TEXT NOT NULL DEFAULT '{}',
    user_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    text_size TEXT NOT NULL DEFAULT 'large' CHECK (text_size IN ('standard', 'large', 'extra_large')),
    high_contrast INTEGER NOT NULL DEFAULT 0,
    speech_enabled INTEGER NOT NULL DEFAULT 1,
    speech_rate REAL NOT NULL DEFAULT 1.0 CHECK (speech_rate BETWEEN 0.5 AND 2.0),
    updated_at TEXT NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    db_path = settings.database_path
    if db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """Initialize local SQLite tables matching the PostgreSQL schema."""
    with _connect() as conn:
        conn.executescript(_SCHEMA_SQL)


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        conn.executescript(_SCHEMA_SQL)
        yield conn
        conn.commit()
    finally:
        conn.close()


def check_db_ready() -> bool:
    """Verify the SQLite database responds to a simple query."""
    try:
        with get_conn() as conn:
            conn.execute("SELECT 1;").fetchone()
        return True
    except sqlite3.Error:
        return False


def parse_json_dict(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}
