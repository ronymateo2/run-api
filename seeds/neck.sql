-- Seed: Fortalecimiento del cuello (cefalea cervicogénica y tensional)
-- Fuente: Jull 2002, Suvarnnato 2019, Ylinen 2003/2010, van Ettekoven 2006.
--
-- SEGURIDAD: el usuario tiene SLAP II en hombro izquierdo + labrum cadera + osteítis púbica.
--   - Componente hombro/mancuerna de Ylinen (press, remos, aperturas, encogimientos,
--     pullovers, banda atada a cabeza al 80%) = CONTRAINDICADO → NO se siembra como ejercicio,
--     solo se nombra como advertencia en la descripción de la Fase 3.
--   - Autorresistencia de extensores: mano DERECHA o toalla (nunca la izquierda).
--
-- Idempotente (INSERT OR REPLACE). user_id resuelto por email.
-- Timestamps en ms (Date.now()), igual que el resto de la app.
-- Aplicar:  npm run seed:neck:local   /   npm run seed:neck:remote

-- ============================================================
-- INJURY
-- ============================================================
INSERT OR REPLACE INTO injuries
  (id, user_id, name, zone, status, current_phase_id, focus_days, started_at, created_at, updated_at)
VALUES (
  'inj_neck',
  (SELECT id FROM users WHERE email = 'ronymateo@gmail.com'),
  'Cuello / Cefalea cervicogénica y tensional',
  'neck',
  'active',
  'ph_neck_1',
  '["mon","tue","wed","thu","fri","sat","sun"]',  -- Fase 1: flexores profundos 2x/día, a diario
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000
);

-- ============================================================
-- FASE 1 — Flexores profundos del cuello (EMPIEZA AQUÍ; segura para hombro y cadera)
-- ============================================================
INSERT OR REPLACE INTO phases
  (id, injury_id, phase_num, name, description, week_start, week_end, threshold_pct, focus_days, deleted_at, created_at, updated_at)
VALUES (
  'ph_neck_1', 'inj_neck', 1,
  'Fase 1 — Flexores profundos (baja carga)',
  'Control motor de los flexores profundos del cuello. Baja carga, NO usa el hombro ni la cadera. Componente común y mejor respaldado de todos los estudios. 2 veces al día.',
  1, 6, 70, NULL, NULL,
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
);

INSERT OR REPLACE INTO exercises
  (id, phase_id, name, detail, sets, reps, duration_s, exercise_type, sort_order, video_url, created_at, updated_at)
VALUES
  ('ex_neck_ccf', 'ph_neck_1',
   'Flexión craneocervical ("decir que sí")',
   'Boca arriba, cabeza apoyada. Asentimiento suave de la cabeza, SIN levantarla y sin tensar el músculo del frente del cuello (esternocleidomastoideo). Biofeedback de presión ideal; alternativa barata = tensiómetro de brazalete bajo la nuca, base 20 mmHg. Progresa 22→24→26→28→30 mmHg solo cuando mantengas el patrón limpio. 2 veces al día.',
   1, 10, 10, 'isometric', 1, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('ex_neck_ext_self', 'ph_neck_1',
   'Extensores — autorresistencia suave (opcional)',
   'OPCIONAL. Toalla o MANO DERECHA en la nuca (NUNCA la izquierda por la lesión SLAP). Empuje suave de la cabeza hacia atrás contra la resistencia, sostener 10 s. Sin dolor.',
   1, 10, 10, 'isometric', 2, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR REPLACE INTO phase_criteria (id, phase_id, description, done, deleted_at, updated_at) VALUES
  ('cr_neck_1a', 'ph_neck_1', 'Sostener 30 mmHg (10 s × 10 rep) con técnica limpia, sin sustituir con el esternocleidomastoideo', 0, NULL, strftime('%s','now') * 1000),
  ('cr_neck_1b', 'ph_neck_1', 'Sin dolor de cuello ni cefalea provocada por el ejercicio', 0, NULL, strftime('%s','now') * 1000),
  ('cr_neck_1c', 'ph_neck_1', 'Flexión craneocervical realizada 2x/día de forma constante (≈4–6 semanas)', 0, NULL, strftime('%s','now') * 1000);

-- ============================================================
-- FASE 2 — Resistencia + escapular y postura (REQUIERE LUZ VERDE DEL FISIO DE HOMBRO)
-- ============================================================
INSERT OR REPLACE INTO phases
  (id, injury_id, phase_num, name, description, week_start, week_end, threshold_pct, focus_days, deleted_at, created_at, updated_at)
VALUES (
  'ph_neck_2', 'inj_neck', 2,
  'Fase 2 — Resistencia + escapular y postura',
  'REQUIERE AUTORIZACIÓN del fisioterapeuta de hombro. El trabajo escapular toca el SLAP: nada de prono con movimiento de brazo ni retracción resistida pesada. Que el fisio FUSIONE el componente escapular con tu rehab de hombro en baja carga, rango corto y sin dolor.',
  7, 12, 70, '["mon","wed","fri"]', NULL,
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
);

INSERT OR REPLACE INTO exercises
  (id, phase_id, name, detail, sets, reps, duration_s, exercise_type, sort_order, video_url, created_at, updated_at)
VALUES
  ('ex_neck_flex_sit', 'ph_neck_2',
   'Control antigravedad de flexores en sedente',
   'Sentado. Movimiento iniciado por el asentimiento (no por el esternocleidomastoideo). Control excéntrico al volver. Sin dolor.',
   1, 10, 10, 'isometric', 1, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('ex_neck_rot_selfresist', 'ph_neck_2',
   'Rotación auto-resistida (10–20 % esfuerzo)',
   'Co-contracción suave. Solo 10–20 % de esfuerzo. Usa la mano derecha o resistencia mínima para no cargar el hombro izquierdo.',
   1, 10, 5, 'isometric', 2, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('ex_neck_scap', 'ph_neck_2',
   'Corrección escapular sostenida (Jull) — ⚠️ con luz verde',
   '⚠️ SOLO con autorización del fisio de hombro. Llevar el omóplato a ligera retracción/rotación externa, sostener 10 s. BAJA CARGA, rango corto, sin dolor. EVITAR prono con brazo y retracción resistida pesada (cargan el SLAP).',
   1, 10, 10, 'strength', 3, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('ex_neck_posture', 'ph_neck_2',
   'Corrección postural desde la pelvis',
   'Sentado, corregir desde la pelvis con base neutra que NO cargue el pubis. Mantener la posición escapular durante el día hasta volverla hábito.',
   1, NULL, 60, 'mobility', 4, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR REPLACE INTO phase_criteria (id, phase_id, description, done, deleted_at, updated_at) VALUES
  ('cr_neck_2a', 'ph_neck_2', 'Luz verde explícita del fisioterapeuta de hombro para el trabajo escapular', 0, NULL, strftime('%s','now') * 1000),
  ('cr_neck_2b', 'ph_neck_2', 'Corrección postural mantenida sin dolor de hombro ni inguinal/púbico', 0, NULL, strftime('%s','now') * 1000),
  ('cr_neck_2c', 'ph_neck_2', 'Resistencia de flexores en sedente con técnica limpia, sin cefalea provocada', 0, NULL, strftime('%s','now') * 1000);

-- ============================================================
-- FASE 3 — Fuerza de mayor carga (SOLO SUPERVISADA; gran parte NO apta hasta alta de hombro)
-- ============================================================
INSERT OR REPLACE INTO phases
  (id, injury_id, phase_num, name, description, week_start, week_end, threshold_pct, focus_days, deleted_at, created_at, updated_at)
VALUES (
  'ph_neck_3', 'inj_neck', 3,
  'Fase 3 — Fuerza de mayor carga (solo supervisada)',
  '⚠️ SOLO SUPERVISADO, con dinamómetro. El componente de HOMBRO/mancuerna de Ylinen (press, remos, aperturas, encogimientos, pullovers, banda atada a la cabeza al 80%) está CONTRAINDICADO hasta el alta de tu hombro (SLAP II + tendinosis supraespinoso + bursitis subacromial) y por eso NO aparece aquí. Solo la parte de cuello, nunca autoprescrita.',
  13, 24, 70, '["mon","thu"]', NULL,
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
);

INSERT OR REPLACE INTO exercises
  (id, phase_id, name, detail, sets, reps, duration_s, exercise_type, sort_order, video_url, created_at, updated_at)
VALUES
  ('ex_neck_band', 'ph_neck_3',
   'Flexores con banda de caucho (ref. Ylinen) — ⚠️ supervisado',
   '⚠️ SOLO SUPERVISADO con dinamómetro. Banda a ~80 % de la fuerza isométrica máxima, 1×15 en sedente. NUNCA autoprescribir cargas altas. Solo el cuello: el componente de hombro de Ylinen está contraindicado.',
   1, 15, NULL, 'strength', 1, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('ex_neck_headlift', 'ph_neck_3',
   'Levantamiento de cabeza (head lift) — ⚠️ fase tardía',
   '⚠️ Alta carga cervical. Solo en fases tardías y supervisado. No carga el hombro, pero exige progresión cuidadosa.',
   1, 10, NULL, 'strength', 2, NULL,
   strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR REPLACE INTO phase_criteria (id, phase_id, description, done, deleted_at, updated_at) VALUES
  ('cr_neck_3a', 'ph_neck_3', 'Autorización médica/fisio + uso de dinamómetro para las cargas altas', 0, NULL, strftime('%s','now') * 1000),
  ('cr_neck_3b', 'ph_neck_3', 'SLAP, tendinosis del supraespinoso y bursitis controladas (alta de hombro)', 0, NULL, strftime('%s','now') * 1000);
