-- Warm-up sets: distinguish warmup rows from working sets so the rollup can exclude
-- them from progress/gating. Default 'normal' keeps every existing row a working set.
ALTER TABLE exercise_logs ADD COLUMN set_type TEXT NOT NULL DEFAULT 'normal';
