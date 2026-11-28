-- OpenQ auth D1 schema.
-- Part 1 is @dawn-studio/auth's schema.sql verbatim (the Dawn app-auth
-- standard): users / magic_tokens / sessions / rate_limits.
-- PII ISOLATION: this DB holds emails — keep it separate from any
-- analytics DB. Apply with:
--   wrangler d1 execute openq-accounts --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS magic_tokens (
	-- token_hash = hex(SHA-256('magic:' + token)); the RAW token never touches D1.
	token_hash TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	-- epoch ms; the intent dies 15 min after issue.
	expires_at INTEGER NOT NULL,
	used INTEGER NOT NULL DEFAULT 0,
	scheme TEXT,
	-- code_hash = hex(SHA-256('code:' + code)); link + code are TWO
	-- CREDENTIALS FOR ONE INTENT: burning either invalidates the other.
	code_hash TEXT,
	code_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON magic_tokens(email);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id),
	-- epoch ms; 30 days after issue.
	expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS rate_limits (
	key TEXT PRIMARY KEY,
	count INTEGER NOT NULL,
	window_start INTEGER NOT NULL
);

-- Part 2 is OpenQ-specific: page ownership. A signed-in user claims an
-- alias (their private page name, u/<alias>); the claim is the ownership
-- record the Gun password used to pretend to be. One alias → one owner.
CREATE TABLE IF NOT EXISTS alias_claims (
	alias TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id),
	email TEXT NOT NULL,
	claimed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alias_claims_user ON alias_claims(user_id);
