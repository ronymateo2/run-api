-- Per-phase training frequency. NULL = fall back to injury.focus_days.
ALTER TABLE phases ADD COLUMN focus_days TEXT;
