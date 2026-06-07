-- PROMs (Patient-Reported Outcome Measures): validated questionnaires (SPADI, HAGOS)
-- with a recurring score over time. `prom_instruments` is global reference content
-- (seeded, pulled to every client). `prom_results` holds per-user completions.

CREATE TABLE IF NOT EXISTS prom_instruments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zones TEXT NOT NULL,
  questions TEXT NOT NULL,
  max_per_item INTEGER NOT NULL,
  invert INTEGER NOT NULL DEFAULT 0,
  better_is_higher INTEGER NOT NULL DEFAULT 0,
  every_days INTEGER NOT NULL DEFAULT 14,
  sort_order INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prom_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  injury_id TEXT NOT NULL REFERENCES injuries(id),
  instrument_id TEXT NOT NULL,
  date TEXT NOT NULL,
  score REAL,
  answers TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prom_results_user_date ON prom_results(user_id, date);
CREATE INDEX IF NOT EXISTS idx_prom_results_user_updated ON prom_results(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_prom_instruments_updated ON prom_instruments(updated_at);
