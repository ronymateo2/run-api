import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";

type Variables = { userId: string; email: string };

const sync = new Hono<{ Bindings: Env; Variables: Variables }>();
sync.use("*", authMiddleware);

// Cap each batch so a client can't push an unbounded array in one request.
const MAX_ROWS = 1000;

const painCheckinSchema = z.object({
  id: z.string().min(1),
  injury_id: z.string().nullish(),
  date: z.string().min(1),
  zones: z.string(),
  created_at: z.number().nullish(),
});

const exerciseLogSchema = z.object({
  id: z.string().min(1),
  exercise_id: z.string().min(1),
  session_date: z.string().min(1),
  reps_done: z.number().nullish(),
  pain_during: z.number().nullish(),
  rpe: z.number().min(0).max(10).nullish(),
  note: z.string().nullish(),
  completed_at: z.number().nullish(),
  deleted_at: z.number().nullish(),
  created_at: z.number().nullish(),
});

const sstResultSchema = z.object({
  id: z.string().min(1),
  injury_id: z.string().min(1),
  date: z.string().min(1),
  strength_score: z.number().nullish(),
  pain_score: z.number().nullish(),
  note: z.string().nullish(),
  created_at: z.number().nullish(),
});

const criteriaDoneSchema = z.object({
  criteria_id: z.string().min(1),
  done: z.boolean(),
});

// Admin-style edits: per-user injury fields (current_phase_id, focus_days only),
// plus full phase + phase_criteria authoring. Ownership is enforced in SQL.
const injuryEditSchema = z.object({
  id: z.string().min(1),
  current_phase_id: z.string().nullish(),
  focus_days: z.string().nullish(),
});

const phaseSchema = z.object({
  id: z.string().min(1),
  injury_id: z.string().min(1),
  phase_num: z.number(),
  name: z.string().min(1),
  description: z.string().nullish(),
  week_start: z.number(),
  week_end: z.number(),
  threshold_pct: z.number().nullish(),
  deleted_at: z.number().nullish(),
});

// Exercise authoring: full row upsert. Ownership via exercise → phase → injury → user.
const exerciseSchema = z.object({
  id: z.string().min(1),
  phase_id: z.string().min(1),
  name: z.string().min(1),
  detail: z.string().nullish(),
  sets: z.number().nullish(),
  reps: z.number().nullish(),
  duration_s: z.number().nullish(),
  exercise_type: z.enum(["isometric", "strength", "mobility", "cardio"]),
  sort_order: z.number().nullish(),
  video_url: z.string().nullish(),
});

// No `done` field: per-user done state flows through criteria_done → user_criteria_done.
const phaseCriteriaSchema = z.object({
  id: z.string().min(1),
  phase_id: z.string().min(1),
  description: z.string().min(1),
  deleted_at: z.number().nullish(),
});

// Unknown keys (user_id, synced, updated_at from the client's SELECT *) are
// stripped by zod's default object parsing — the server never trusts them.
const pushSchema = z.object({
  pain_checkins: z.array(painCheckinSchema).max(MAX_ROWS).optional(),
  exercise_logs: z.array(exerciseLogSchema).max(MAX_ROWS).optional(),
  sst_results: z.array(sstResultSchema).max(MAX_ROWS).optional(),
  criteria_done: z.array(criteriaDoneSchema).max(MAX_ROWS).optional(),
  injuries: z.array(injuryEditSchema).max(MAX_ROWS).optional(),
  phases: z.array(phaseSchema).max(MAX_ROWS).optional(),
  exercises: z.array(exerciseSchema).max(MAX_ROWS).optional(),
  phase_criteria: z.array(phaseCriteriaSchema).max(MAX_ROWS).optional(),
});

// GET /sync/pull?since=<unix_ms>
// Returns all user rows updated after `since`
sync.get("/pull", async (c) => {
  const userId = c.get("userId");
  const since = Number(c.req.query("since") ?? 0);

  const [checkins, logs, sst, injuries, phases, exercises, phaseCriteria] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM pain_checkins WHERE user_id = ? AND updated_at > ?`
    ).bind(userId, since).all(),
    c.env.DB.prepare(
      `SELECT * FROM exercise_logs WHERE user_id = ? AND updated_at > ?`
    ).bind(userId, since).all(),
    c.env.DB.prepare(
      `SELECT * FROM sst_results WHERE user_id = ? AND updated_at > ?`
    ).bind(userId, since).all(),
    c.env.DB.prepare(
      `SELECT * FROM injuries WHERE user_id = ? AND updated_at > ?`
    ).bind(userId, since).all(),
    c.env.DB.prepare(
      `SELECT p.* FROM phases p
       JOIN injuries i ON i.id = p.injury_id
       WHERE i.user_id = ? AND p.updated_at > ?`
    ).bind(userId, since).all(),
    c.env.DB.prepare(
      `SELECT e.* FROM exercises e
       JOIN phases p ON p.id = e.phase_id
       JOIN injuries i ON i.id = p.injury_id
       WHERE i.user_id = ? AND e.updated_at > ?`
    ).bind(userId, since).all(),
    c.env.DB.prepare(
      `SELECT pc.id, pc.phase_id, pc.description, pc.deleted_at,
              COALESCE(ucd.done, pc.done) AS done,
              CASE WHEN COALESCE(ucd.updated_at, 0) > pc.updated_at
                   THEN ucd.updated_at ELSE pc.updated_at END AS updated_at
       FROM phase_criteria pc
       LEFT JOIN user_criteria_done ucd ON ucd.criteria_id = pc.id AND ucd.user_id = ?
       JOIN phases p ON p.id = pc.phase_id
       JOIN injuries i ON i.id = p.injury_id
       WHERE i.user_id = ?
         AND (pc.updated_at > ? OR COALESCE(ucd.updated_at, 0) > ?)`
    ).bind(userId, userId, since, since).all(),
  ]);

  return c.json({
    serverTime: Date.now(),
    pain_checkins: checkins.results,
    exercise_logs: logs.results,
    sst_results: sst.results,
    injuries: injuries.results,
    phases: phases.results,
    exercises: exercises.results,
    phase_criteria: phaseCriteria.results,
  });
});

// POST /sync/push
// Upserts local rows into D1
sync.post("/push", zValidator("json", pushSchema), async (c) => {
  const userId = c.get("userId");
  const body = c.req.valid("json");

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];

  for (const row of body.pain_checkins ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO pain_checkins (id, user_id, injury_id, date, zones, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET zones = excluded.zones, updated_at = excluded.updated_at
         WHERE user_id = excluded.user_id`
      ).bind(row.id, userId, row.injury_id ?? null, row.date, row.zones, row.created_at ?? now, now)
    );
  }

  for (const row of body.exercise_logs ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO exercise_logs (id, user_id, exercise_id, session_date, reps_done, pain_during, rpe, note, completed_at, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET reps_done = excluded.reps_done, pain_during = excluded.pain_during, rpe = excluded.rpe, note = excluded.note, completed_at = excluded.completed_at, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at
         WHERE user_id = excluded.user_id`
      ).bind(row.id, userId, row.exercise_id, row.session_date, row.reps_done ?? null, row.pain_during ?? null, row.rpe ?? null, row.note ?? null, row.completed_at ?? null, row.deleted_at ?? null, row.created_at ?? now, now)
    );
  }

  for (const row of body.sst_results ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO sst_results (id, user_id, injury_id, date, strength_score, pain_score, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET strength_score = excluded.strength_score, pain_score = excluded.pain_score, note = excluded.note, updated_at = excluded.updated_at
         WHERE user_id = excluded.user_id`
      ).bind(row.id, userId, row.injury_id, row.date, row.strength_score ?? null, row.pain_score ?? null, row.note ?? null, row.created_at ?? now, now)
    );
  }

  for (const row of body.criteria_done ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO user_criteria_done (user_id, criteria_id, done, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, criteria_id) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at`
      ).bind(userId, row.criteria_id, row.done ? 1 : 0, now)
    );
  }

  // Injuries: only current_phase_id + focus_days are client-editable. UPDATE-only
  // (no create) and scoped to the owner — name/zone/status/user_id never change.
  for (const row of body.injuries ?? []) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE injuries SET current_phase_id = ?, focus_days = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).bind(row.current_phase_id ?? null, row.focus_days ?? null, now, row.id, userId)
    );
  }

  // Phases: create or edit. INSERT-SELECT guards create against non-owned injuries;
  // the conflict WHERE guards edits to phases under the user's own injuries.
  for (const row of body.phases ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO phases (id, injury_id, phase_num, name, description, week_start, week_end, threshold_pct, deleted_at, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM injuries i WHERE i.id = ? AND i.user_id = ?)
         ON CONFLICT(id) DO UPDATE SET
           phase_num = excluded.phase_num, name = excluded.name, description = excluded.description,
           week_start = excluded.week_start, week_end = excluded.week_end,
           threshold_pct = excluded.threshold_pct, deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at
         WHERE phases.injury_id IN (SELECT id FROM injuries WHERE user_id = ?)`
      ).bind(
        row.id, row.injury_id, row.phase_num, row.name, row.description ?? null,
        row.week_start, row.week_end, row.threshold_pct ?? 70, row.deleted_at ?? null, now, now,
        row.injury_id, userId, userId
      )
    );
  }

  // Exercises: full-row authoring. INSERT-SELECT guards create against non-owned phases;
  // the conflict WHERE guards edits to exercises under the user's own phases.
  for (const row of body.exercises ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO exercises (id, phase_id, name, detail, sets, reps, duration_s, exercise_type, sort_order, video_url, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM phases p JOIN injuries i ON i.id = p.injury_id
           WHERE p.id = ? AND i.user_id = ?
         )
         ON CONFLICT(id) DO UPDATE SET
           phase_id = excluded.phase_id, name = excluded.name, detail = excluded.detail,
           sets = excluded.sets, reps = excluded.reps, duration_s = excluded.duration_s,
           exercise_type = excluded.exercise_type, sort_order = excluded.sort_order,
           video_url = excluded.video_url, updated_at = excluded.updated_at
         WHERE exercises.phase_id IN (
           SELECT p.id FROM phases p JOIN injuries i ON i.id = p.injury_id WHERE i.user_id = ?
         )`
      ).bind(
        row.id, row.phase_id, row.name, row.detail ?? null, row.sets ?? null, row.reps ?? null,
        row.duration_s ?? null, row.exercise_type, row.sort_order ?? 0, row.video_url ?? null, now, now,
        row.phase_id, userId, userId
      )
    );
  }

  // Phase criteria: description authoring (never touches global `done`). Ownership via
  // phase → injury → user. INSERT defaults done=0; edits never set done.
  for (const row of body.phase_criteria ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO phase_criteria (id, phase_id, description, done, deleted_at, updated_at)
         SELECT ?, ?, ?, 0, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM phases p JOIN injuries i ON i.id = p.injury_id
           WHERE p.id = ? AND i.user_id = ?
         )
         ON CONFLICT(id) DO UPDATE SET
           description = excluded.description, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at
         WHERE phase_criteria.phase_id IN (
           SELECT p.id FROM phases p JOIN injuries i ON i.id = p.injury_id WHERE i.user_id = ?
         )`
      ).bind(row.id, row.phase_id, row.description, row.deleted_at ?? null, now, row.phase_id, userId, userId)
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ synced: statements.length, serverTime: now });
});

export default sync;
