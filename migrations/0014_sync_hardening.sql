-- Sync hardening:
-- 1. client_updated_at on every client-pushed table → LWW by edit time, not by
--    arrival order (a stale offline device can no longer overwrite a newer edit).
-- 2. deleted_at tombstones on pain_checkins / sst_results / prom_results so
--    deletes can propagate to clients (exercise_logs/phases/criteria already have it).
-- 3. Materialized log_day_counts: the pull used to GROUP BY the user's ENTIRE
--    exercise_logs history on every request; now push maintains the rollup
--    incrementally and pull reads the table with a keyset cursor.

ALTER TABLE pain_checkins ADD COLUMN client_updated_at INTEGER;
ALTER TABLE exercise_logs ADD COLUMN client_updated_at INTEGER;
ALTER TABLE sst_results ADD COLUMN client_updated_at INTEGER;
ALTER TABLE prom_results ADD COLUMN client_updated_at INTEGER;
ALTER TABLE injuries ADD COLUMN client_updated_at INTEGER;
ALTER TABLE phases ADD COLUMN client_updated_at INTEGER;
ALTER TABLE exercises ADD COLUMN client_updated_at INTEGER;
ALTER TABLE phase_criteria ADD COLUMN client_updated_at INTEGER;
ALTER TABLE user_criteria_done ADD COLUMN client_updated_at INTEGER;

ALTER TABLE pain_checkins ADD COLUMN deleted_at INTEGER;
ALTER TABLE sst_results ADD COLUMN deleted_at INTEGER;
ALTER TABLE prom_results ADD COLUMN deleted_at INTEGER;

CREATE TABLE IF NOT EXISTS log_day_counts (
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  sets INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, exercise_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_log_day_counts_user_updated ON log_day_counts(user_id, updated_at);

-- Backfill from existing logs. updated_at = the group's max so the next client
-- pull (watermark-based) picks every group up exactly once.
INSERT OR REPLACE INTO log_day_counts (user_id, exercise_id, session_date, sets, updated_at)
SELECT user_id, exercise_id, session_date,
       SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END),
       MAX(updated_at)
FROM exercise_logs
GROUP BY user_id, exercise_id, session_date;
