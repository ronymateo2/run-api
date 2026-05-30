-- Rurana D1 schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  timezone TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_auth_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_sub TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_sub)
);

CREATE TABLE IF NOT EXISTS injuries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_phase_id TEXT,
  focus_days TEXT,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  injury_id TEXT NOT NULL REFERENCES injuries(id),
  phase_num INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  week_start INTEGER NOT NULL,
  week_end INTEGER NOT NULL,
  threshold_pct INTEGER NOT NULL DEFAULT 70,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phase_criteria (
  id TEXT PRIMARY KEY,
  phase_id TEXT NOT NULL REFERENCES phases(id),
  description TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_criteria_done (
  user_id TEXT NOT NULL REFERENCES users(id),
  criteria_id TEXT NOT NULL REFERENCES phase_criteria(id),
  done INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, criteria_id)
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  phase_id TEXT NOT NULL REFERENCES phases(id),
  name TEXT NOT NULL,
  detail TEXT,
  sets INTEGER,
  reps INTEGER,
  duration_s INTEGER,
  exercise_type TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pain_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  injury_id TEXT REFERENCES injuries(id),
  date TEXT NOT NULL,
  zones TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  session_date TEXT NOT NULL,
  reps_done INTEGER,
  pain_during INTEGER,
  rpe INTEGER,
  note TEXT,
  completed_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sst_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  injury_id TEXT NOT NULL REFERENCES injuries(id),
  date TEXT NOT NULL,
  strength_score REAL,
  pain_score INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pain_checkins_user_date ON pain_checkins(user_id, date);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_date ON exercise_logs(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_sst_results_user_date ON sst_results(user_id, date);
CREATE INDEX IF NOT EXISTS idx_injuries_user ON injuries(user_id);
CREATE INDEX IF NOT EXISTS idx_phases_injury ON phases(injury_id);
CREATE INDEX IF NOT EXISTS idx_exercises_phase ON exercises(phase_id);
