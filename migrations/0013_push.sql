-- Web Push reminders. One subscription row per device; reminder prefs on users.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Master switch + delivery time (local hour 0-23) + dedupe stamp (local YYYY-MM-DD).
ALTER TABLE users ADD COLUMN reminder_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN reminder_hour INTEGER NOT NULL DEFAULT 8;
ALTER TABLE users ADD COLUMN reminder_last_date TEXT;
