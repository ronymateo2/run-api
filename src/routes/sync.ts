import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";

type Variables = { userId: string; email: string };

const sync = new Hono<{ Bindings: Env; Variables: Variables }>();
sync.use("*", authMiddleware);

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
      `SELECT pc.* FROM phase_criteria pc
       JOIN phases p ON p.id = pc.phase_id
       JOIN injuries i ON i.id = p.injury_id
       WHERE i.user_id = ? AND pc.updated_at > ?`
    ).bind(userId, since).all(),
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
sync.post("/push", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    pain_checkins?: PainCheckinRow[];
    exercise_logs?: ExerciseLogRow[];
    sst_results?: SstResultRow[];
  }>();

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];

  for (const row of body.pain_checkins ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO pain_checkins (id, user_id, injury_id, date, zones, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET zones = excluded.zones, updated_at = excluded.updated_at`
      ).bind(row.id, userId, row.injury_id ?? null, row.date, row.zones, row.created_at ?? now, now)
    );
  }

  for (const row of body.exercise_logs ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO exercise_logs (id, user_id, exercise_id, session_date, reps_done, pain_during, rpe, note, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET reps_done = excluded.reps_done, pain_during = excluded.pain_during, rpe = excluded.rpe, note = excluded.note, updated_at = excluded.updated_at`
      ).bind(row.id, userId, row.exercise_id, row.session_date, row.reps_done ?? null, row.pain_during ?? null, row.rpe ?? null, row.note ?? null, row.completed_at ?? null, row.created_at ?? now, now)
    );
  }

  for (const row of body.sst_results ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO sst_results (id, user_id, injury_id, date, strength_score, pain_score, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET strength_score = excluded.strength_score, pain_score = excluded.pain_score, note = excluded.note, updated_at = excluded.updated_at`
      ).bind(row.id, userId, row.injury_id, row.date, row.strength_score ?? null, row.pain_score ?? null, row.note ?? null, row.created_at ?? now, now)
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ synced: statements.length, serverTime: now });
});

// Row types for push payload
interface PainCheckinRow {
  id: string; injury_id?: string; date: string; zones: string; created_at?: number;
}
interface ExerciseLogRow {
  id: string; exercise_id: string; session_date: string;
  reps_done?: number; pain_during?: number; rpe?: number; note?: string;
  completed_at?: number; created_at?: number;
}
interface SstResultRow {
  id: string; injury_id: string; date: string;
  strength_score?: number; pain_score?: number; note?: string; created_at?: number;
}

export default sync;
