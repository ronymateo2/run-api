import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";

const phases = new Hono<{ Bindings: Env; Variables: { userId: string; email: string } }>();
phases.use("*", authMiddleware);

// GET /phases — all phases + criteria for the authenticated user's injuries
phases.get("/", async (c) => {
  const userId = c.get("userId");

  const injuries = await c.env.DB.prepare(
    `SELECT * FROM injuries WHERE user_id = ?`
  ).bind(userId).all();

  const phaseRows = await c.env.DB.prepare(
    `SELECT p.*, pc.id as crit_id, pc.description as crit_desc, pc.done as crit_done
     FROM phases p
     LEFT JOIN phase_criteria pc ON pc.phase_id = p.id
     JOIN injuries i ON i.id = p.injury_id
     WHERE i.user_id = ?
     ORDER BY p.injury_id, p.phase_num, pc.id`
  ).bind(userId).all<{
    id: string; injury_id: string; phase_num: number; name: string;
    description: string; week_start: number; week_end: number; threshold_pct: number;
    crit_id: string; crit_desc: string; crit_done: number;
  }>();

  // Group criteria into phases
  const phaseMap = new Map<string, {
    id: string; injury_id: string; phase_num: number; name: string;
    description: string; week_start: number; week_end: number; threshold_pct: number;
    criteria: { id: string; description: string; done: boolean }[];
  }>();

  for (const row of phaseRows.results) {
    if (!phaseMap.has(row.id)) {
      phaseMap.set(row.id, {
        id: row.id, injury_id: row.injury_id, phase_num: row.phase_num,
        name: row.name, description: row.description,
        week_start: row.week_start, week_end: row.week_end,
        threshold_pct: row.threshold_pct, criteria: [],
      });
    }
    if (row.crit_id) {
      phaseMap.get(row.id)!.criteria.push({
        id: row.crit_id, description: row.crit_desc, done: Boolean(row.crit_done),
      });
    }
  }

  // Compute progress per phase
  const exercises = await c.env.DB.prepare(
    `SELECT e.phase_id, COUNT(DISTINCT el.id) as completed_sessions
     FROM exercises e
     LEFT JOIN exercise_logs el ON el.exercise_id = e.id
     JOIN phases p ON p.id = e.phase_id
     JOIN injuries i ON i.id = p.injury_id
     WHERE i.user_id = ?
     GROUP BY e.phase_id`
  ).bind(userId).all<{ phase_id: string; completed_sessions: number }>();

  const sessionsByPhase = new Map(exercises.results.map(r => [r.phase_id, r.completed_sessions]));

  const result = Array.from(phaseMap.values()).map(p => {
    const criteriaTotal = p.criteria.length;
    const criteriaDone = p.criteria.filter(c => c.done).length;
    const progressPct = criteriaTotal > 0 ? Math.round((criteriaDone / criteriaTotal) * 100) : 0;
    return { ...p, progress_pct: progressPct, completed_sessions: sessionsByPhase.get(p.id) ?? 0 };
  });

  return c.json({ injuries: injuries.results, phases: result });
});

export default phases;
