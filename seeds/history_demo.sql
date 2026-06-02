-- Seed: demo de historial largo (180 días) para probar el sync escalable.
--
-- Genera ~1620 exercise_logs (180 días × 3 ejercicios × 3 sets), 180 pain_checkins
-- y ~26 sst_results, todos fechados desde hoy hacia atrás 180 días. Sirve para
-- verificar:
--   - Paginación: >500 filas en el stream exercise_logs → varias páginas (PAGE_LIMIT=500).
--   - Ventana (WINDOW_DAYS=120): el cliente solo baja raw de los últimos 120 días;
--     los ~60 días más viejos NO llegan como raw pero SÍ alimentan el rollup.
--   - Rollup (log_day_counts): el progreso/gating cubre los 180 días aunque el raw
--     esté windoweado.
--   - Historia on-demand: abrir un día >120d en el calendario dispara pullHistory.
--
-- Requisitos previos (mismo email que el resto):
--   1) Haber iniciado sesión una vez (crea la fila users con email ronymateo@gmail.com).
--   2) npm run seed:neck:local   (crea inj_neck + ejercicios ex_neck_* referenciados por FK).
--
-- Idempotente (INSERT OR REPLACE, ids deterministas user:exercise:date:set).
-- Aplicar:  npm run seed:history:local   /   npm run seed:history:remote

-- ============================================================
-- exercise_logs — 180 días × 3 ejercicios × 3 sets
-- ============================================================
WITH RECURSIVE
  days(n)   AS (SELECT 0 UNION ALL SELECT n + 1 FROM days   WHERE n < 179),
  setseq(s) AS (SELECT 0 UNION ALL SELECT s + 1 FROM setseq WHERE s < 2),
  ex(exercise_id) AS (VALUES ('ex_neck_ccf'), ('ex_neck_scap'), ('ex_neck_posture')),
  u(id) AS (SELECT id FROM users WHERE email = 'ronymateo@gmail.com')
INSERT OR REPLACE INTO exercise_logs
  (id, user_id, exercise_id, session_date, reps_done, pain_during, rpe, note, completed_at, deleted_at, created_at, updated_at)
SELECT
  u.id || ':' || ex.exercise_id || ':' || date('now', '-' || days.n || ' days') || ':' || setseq.s,
  u.id,
  ex.exercise_id,
  date('now', '-' || days.n || ' days'),
  10, 1, 5, NULL,
  strftime('%s', 'now', '-' || days.n || ' days') * 1000,
  NULL,
  strftime('%s', 'now', '-' || days.n || ' days') * 1000,
  strftime('%s', 'now', '-' || days.n || ' days') * 1000
FROM days CROSS JOIN setseq CROSS JOIN ex CROSS JOIN u;

-- ============================================================
-- pain_checkins — 1 por día, 180 días
-- ============================================================
WITH RECURSIVE
  days(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 179),
  u(id) AS (SELECT id FROM users WHERE email = 'ronymateo@gmail.com')
INSERT OR REPLACE INTO pain_checkins
  (id, user_id, injury_id, date, zones, created_at, updated_at)
SELECT
  u.id || ':checkin:' || date('now', '-' || days.n || ' days'),
  u.id,
  'inj_neck',
  date('now', '-' || days.n || ' days'),
  '{"pubis":2,"ingleL":1}',
  strftime('%s', 'now', '-' || days.n || ' days') * 1000,
  strftime('%s', 'now', '-' || days.n || ' days') * 1000
FROM days CROSS JOIN u;

-- ============================================================
-- sst_results — cada 7 días, 180 días (~26)
-- ============================================================
WITH RECURSIVE
  wk(n) AS (SELECT 0 UNION ALL SELECT n + 7 FROM wk WHERE n < 179),
  u(id) AS (SELECT id FROM users WHERE email = 'ronymateo@gmail.com')
INSERT OR REPLACE INTO sst_results
  (id, user_id, injury_id, date, strength_score, pain_score, note, created_at, updated_at)
SELECT
  u.id || ':sst:' || date('now', '-' || wk.n || ' days'),
  u.id,
  'inj_neck',
  date('now', '-' || wk.n || ' days'),
  6.0, 2, NULL,
  strftime('%s', 'now', '-' || wk.n || ' days') * 1000,
  strftime('%s', 'now', '-' || wk.n || ' days') * 1000
FROM wk CROSS JOIN u;
