import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  ref TEXT,
  address TEXT,
  postcode TEXT,
  uprn TEXT,
  firm TEXT,
  form_version TEXT DEFAULT 'TA6 6th edition (2025)',
  status TEXT DEFAULT 'collecting',      -- collecting | in_review | signed | withdrawn
  deadline TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  signed_at TEXT
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                    -- seller | solicitor
  name TEXT,
  email TEXT,
  phone TEXT,
  whatsapp_opt_in INTEGER DEFAULT 0,
  cadence TEXT,                          -- JSON
  plan TEXT,                             -- JSON: questions per session / time budget
  ignored_streak INTEGER DEFAULT 0,
  last_activity_at TEXT,
  last_nudge_at TEXT,
  last_inbound_at TEXT,
  signed_at TEXT
);

CREATE TABLE IF NOT EXISTS answers (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  value TEXT,                            -- JSON
  status TEXT DEFAULT 'answered',        -- answered | parked | prefilled | unknown
  revisit_at TEXT,
  source TEXT,                           -- web | whatsapp | sms | prefill:<provider> | solicitor
  answered_by TEXT REFERENCES participants(id),
  answered_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (case_id, item_id)
);

-- Append-only. A buyer can claim against a seller for a wrong answer, so every
-- version of every answer is kept with who said it, when and from where.
CREATE TABLE IF NOT EXISTS answer_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  value TEXT,
  status TEXT,
  source TEXT,
  answered_by TEXT,
  answered_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  item_id TEXT,
  filename TEXT,
  mime TEXT,
  bytes INTEGER,
  path TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS links (
  token_hash TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  purpose TEXT DEFAULT 'answer',          -- answer | review_and_sign
  expires_at TEXT NOT NULL,
  single_use INTEGER DEFAULT 0,
  used_at TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  kind TEXT,                              -- invite | nudge | question | paperwork | review | handoff
  payload TEXT,
  send_after TEXT,
  sent_at TEXT,
  attempts INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT,
  participant_id TEXT,
  channel TEXT,
  raw TEXT,
  received_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT,
  kind TEXT,
  detail TEXT,
  at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_answers_case ON answers(case_id);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(sent_at, send_after);
CREATE INDEX IF NOT EXISTS idx_history_case ON answer_history(case_id, item_id);
`;

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
