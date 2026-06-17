-- Voice-guided per-rep phases: JSON array of {cue, seconds}. null/[] = no guided mode.
ALTER TABLE exercises ADD COLUMN rep_phases TEXT;
