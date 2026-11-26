-- Initial schema proposal. Review and convert to Alembic-managed migrations
-- before production use. This file has NOT been applied or validated.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_subject TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE model_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name TEXT NOT NULL,
    version TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('development','staging','production','retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_name, version)
);

CREATE TABLE cash_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency CHAR(3) NOT NULL DEFAULT 'NGN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ
);

CREATE TABLE cash_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    predicted_denomination INTEGER,
    confirmed_denomination INTEGER,
    confidence NUMERIC(6,5),
    confirmation_status TEXT NOT NULL CHECK (
      confirmation_status IN ('pending','confirmed','corrected','rejected')
    ),
    model_version_id UUID REFERENCES model_versions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (predicted_denomination IS NULL OR predicted_denomination IN (5,10,20,50,100,200,500,1000)),
    CHECK (confirmed_denomination IS NULL OR confirmed_denomination IN (5,10,20,50,100,200,500,1000)),
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CHECK (confirmation_status NOT IN ('confirmed','corrected') OR confirmed_denomination IS NOT NULL)
);

CREATE INDEX idx_cash_entries_user_created ON cash_entries(user_id, created_at DESC);

CREATE TABLE transaction_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_kobo BIGINT CHECK (amount_kobo IS NULL OR amount_kobo >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'NGN',
    transaction_date TIMESTAMPTZ,
    reference TEXT,
    sender_label TEXT,
    recipient_label TEXT,
    reported_status TEXT,
    source_type TEXT NOT NULL CHECK (
      source_type IN ('notification','receipt','pasted_text','other')
    ),
    extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transaction_records_user_created ON transaction_records(user_id, created_at DESC);

CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    text_size TEXT NOT NULL DEFAULT 'large' CHECK (text_size IN ('standard','large','extra_large')),
    high_contrast BOOLEAN NOT NULL DEFAULT FALSE,
    speech_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    speech_rate NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (speech_rate BETWEEN 0.5 AND 2.0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inference_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    model_version_id UUID REFERENCES model_versions(id),
    task_type TEXT NOT NULL CHECK (task_type IN ('banknote','ocr')),
    result TEXT,
    confidence NUMERIC(6,5) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
