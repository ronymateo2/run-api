-- Equipment per exercise + target RPE per exercise; logged equipment value per set.
ALTER TABLE exercises ADD COLUMN equipment_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE exercises ADD COLUMN target_rpe INTEGER;
ALTER TABLE exercise_logs ADD COLUMN load REAL;
ALTER TABLE exercise_logs ADD COLUMN band TEXT;
