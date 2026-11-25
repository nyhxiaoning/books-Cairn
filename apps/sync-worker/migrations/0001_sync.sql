PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_account (
  id TEXT PRIMARY KEY NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admin_account(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admin_account(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  budget_id TEXT NOT NULL,
  language TEXT NOT NULL,
  voice TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS books_admin_id_idx ON books(admin_id);

CREATE TABLE IF NOT EXISTS book_resources (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (book_id, path)
);

CREATE TABLE IF NOT EXISTS reading_progress (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  station_id TEXT,
  updated_at TEXT NOT NULL
);
