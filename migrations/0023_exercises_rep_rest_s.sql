-- Auto-rest between reps (seconds) in guided mode. null/0 = no pause between reps.
ALTER TABLE exercises ADD COLUMN rep_rest_s INTEGER;
