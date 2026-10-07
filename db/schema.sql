CREATE TABLE IF NOT EXISTS boji_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS boji_account (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS boji_one_owner ON boji_account(role) WHERE role='owner';
CREATE TABLE IF NOT EXISTS boji_invite (
  code_hash TEXT PRIMARY KEY, role TEXT NOT NULL, expires_at BIGINT NOT NULL,
  used_by TEXT REFERENCES boji_account(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boji_session (
  token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL, expires_at BIGINT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS boji_session_expiry ON boji_session(expires_at);
CREATE TABLE IF NOT EXISTS boji_rate (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS boji_rate_expiry ON boji_rate(expires_at);
CREATE TABLE IF NOT EXISTS boji_usage (
  key TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY(key,day)
);
CREATE TABLE IF NOT EXISTS boji_lease (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS boji_lease_expiry ON boji_lease(expires_at);
CREATE TABLE IF NOT EXISTS boji_profile (
  account_id TEXT PRIMARY KEY REFERENCES boji_account(id) ON DELETE CASCADE,
  input JSONB NOT NULL, timezone TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boji_plan (
  account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, calculation JSONB NOT NULL, effective_at TEXT NOT NULL,
  local_date TEXT NOT NULL, PRIMARY KEY(account_id,version)
);
CREATE TABLE IF NOT EXISTS boji_meal (
  account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  id TEXT NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  plan_version INTEGER NOT NULL, payload JSONB NOT NULL, PRIMARY KEY(account_id,id),
  FOREIGN KEY(account_id,plan_version) REFERENCES boji_plan(account_id,version)
);
CREATE INDEX IF NOT EXISTS boji_meal_date ON boji_meal(account_id,date,created_at,id);
CREATE TABLE IF NOT EXISTS boji_revision (
  account_id TEXT NOT NULL, id TEXT NOT NULL, meal_id TEXT NOT NULL, changed_at TEXT NOT NULL,
  before_json JSONB NOT NULL, after_json JSONB NOT NULL, reason TEXT NOT NULL,
  PRIMARY KEY(account_id,id),
  FOREIGN KEY(account_id,meal_id) REFERENCES boji_meal(account_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS boji_message (
  account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  id TEXT NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL, sequence BIGSERIAL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  related_meal_id TEXT, payload JSONB NOT NULL, PRIMARY KEY(account_id,id)
);
CREATE INDEX IF NOT EXISTS boji_message_date ON boji_message(account_id,date,created_at,sequence);
CREATE TABLE IF NOT EXISTS boji_turn (
  account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL, request_hash TEXT NOT NULL, completed_at TEXT NOT NULL,
  result JSONB NOT NULL, PRIMARY KEY(account_id,request_id)
);
CREATE TABLE IF NOT EXISTS boji_clarification (
  account_id TEXT PRIMARY KEY REFERENCES boji_account(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL, date TEXT NOT NULL, image_json TEXT, asked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boji_memory (
  account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id,id), UNIQUE(account_id,text)
);
CREATE TABLE IF NOT EXISTS boji_media (
  account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  id TEXT NOT NULL, mime TEXT NOT NULL, pathname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','ready','deleting')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(account_id,id)
);
CREATE INDEX IF NOT EXISTS boji_media_gc ON boji_media(status,created_at);
CREATE TABLE IF NOT EXISTS boji_model_call (
  account_id TEXT NOT NULL REFERENCES boji_account(id) ON DELETE CASCADE,
  id TEXT NOT NULL, request_id TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
  PRIMARY KEY(account_id,id)
);
INSERT INTO boji_schema(id,version) VALUES(1,1) ON CONFLICT(id) DO NOTHING;
