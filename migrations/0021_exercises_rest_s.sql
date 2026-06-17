-- Auto-rest between sets (seconds) for time-based exercises. null/0 = manual (no chaining).
ALTER TABLE exercises ADD COLUMN rest_s INTEGER;
