-- Indexes for join + sync-delta query paths.

-- Join columns with no index (full scans today):
--   phases.ts / sync.ts: LEFT JOIN phase_criteria pc ON pc.phase_id = p.id
--   phases.ts:           LEFT JOIN exercise_logs el ON el.exercise_id = e.id
CREATE INDEX IF NOT EXISTS idx_phase_criteria_phase ON phase_criteria(phase_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_exercise ON exercise_logs(exercise_id);

-- Sync delta reads filter `WHERE user_id = ? AND updated_at > ?`. The existing
-- (user_id, date) indexes only serve the equality; these compounds let the
-- index serve the updated_at range too.
CREATE INDEX IF NOT EXISTS idx_pain_checkins_user_updated ON pain_checkins(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_updated ON exercise_logs(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sst_results_user_updated ON sst_results(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_injuries_user_updated ON injuries(user_id, updated_at);
