-- Soft delete for exercise_logs. Deselected sets keep their row with deleted_at set;
-- re-checking nulls it. Physical row count stays bounded (ids are deterministic), and
-- the flag rides the existing upsert sync. Reads must filter `deleted_at IS NULL`.
ALTER TABLE exercise_logs ADD COLUMN deleted_at INTEGER;
