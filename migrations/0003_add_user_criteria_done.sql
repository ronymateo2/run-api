CREATE TABLE IF NOT EXISTS user_criteria_done (
  user_id TEXT NOT NULL REFERENCES users(id),
  criteria_id TEXT NOT NULL REFERENCES phase_criteria(id),
  done INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, criteria_id)
);
CREATE INDEX IF NOT EXISTS idx_user_criteria_done_user ON user_criteria_done(user_id, updated_at);
