-- Index for the sync rollup (log_day_counts stream): the pull groups
-- exercise_logs by (user_id, exercise_id, session_date). Also serves the
-- windowed raw pull filter `WHERE user_id = ? AND session_date >= ?`.
CREATE INDEX IF NOT EXISTS idx_exercise_logs_rollup
  ON exercise_logs(user_id, exercise_id, session_date);
