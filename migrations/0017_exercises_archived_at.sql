-- Archive (not delete) exercises: hides them from the active plan + progress.
ALTER TABLE exercises ADD COLUMN archived_at INTEGER;
