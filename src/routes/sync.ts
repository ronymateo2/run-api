import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";

type Variables = { userId: string; email: string };

const sync = new Hono<{ Bindings: Env; Variables: Variables }>();
sync.use("*", authMiddleware);

// Per-user rate limit: a sync cycle is 1 push + a handful of pull pages, so 120/min
// leaves headroom while a buggy retry loop can't hammer D1.
sync.use("*", async (c, next) => {
  const limiter = (c.env as Env & { SYNC_RATE_LIMITER?: RateLimit }).SYNC_RATE_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `sync:${c.get("userId")}` });
    if (!success) return c.json({ error: "Too many requests" }, 429);
  }
  await next();
});

// Cap each batch so a client can't push an unbounded array in one request.
const MAX_ROWS = 1000;

// client_updated_at: ms timestamp taken on the client at enqueue time. Conflict
// updates only apply when the incoming edit is not older than the stored one
// (LWW by edit time). NULL (old clients) always applies — legacy behavior.
const painCheckinSchema = z.object({
  id: z.string().min(1),
  injury_id: z.string().nullish(),
  date: z.string().min(1),
  zones: z.string(),
  deleted_at: z.number().nullish(),
  created_at: z.number().nullish(),
  client_updated_at: z.number().nullish(),
});

const exerciseLogSchema = z.object({
  id: z.string().min(1),
  exercise_id: z.string().min(1),
  session_date: z.string().min(1),
  reps_done: z.number().nullish(),
  pain_during: z.number().nullish(),
  rpe: z.number().min(0).max(10).nullish(),
  note: z.string().nullish(),
  set_type: z.enum(["normal", "warmup"]).nullish(),
  completed_at: z.number().nullish(),
  deleted_at: z.number().nullish(),
  created_at: z.number().nullish(),
  client_updated_at: z.number().nullish(),
});

const sstResultSchema = z.object({
  id: z.string().min(1),
  injury_id: z.string().min(1),
  date: z.string().min(1),
  strength_score: z.number().nullish(),
  pain_score: z.number().nullish(),
  note: z.string().nullish(),
  deleted_at: z.number().nullish(),
  created_at: z.number().nullish(),
  client_updated_at: z.number().nullish(),
});

const promResultSchema = z.object({
  id: z.string().min(1),
  injury_id: z.string().min(1),
  instrument_id: z.string().min(1),
  date: z.string().min(1),
  score: z.number().nullish(),
  answers: z.string().nullish(),
  note: z.string().nullish(),
  deleted_at: z.number().nullish(),
  created_at: z.number().nullish(),
  client_updated_at: z.number().nullish(),
});

const criteriaDoneSchema = z.object({
  criteria_id: z.string().min(1),
  done: z.boolean(),
  client_updated_at: z.number().nullish(),
});

// Admin-style edits: per-user injury fields (current_phase_id, focus_days only),
// plus full phase + phase_criteria authoring. Ownership is enforced in SQL.
const injuryEditSchema = z.object({
  id: z.string().min(1),
  current_phase_id: z.string().nullish(),
  focus_days: z.string().nullish(),
  client_updated_at: z.number().nullish(),
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
  focus_days: z.string().nullish(),
  deleted_at: z.number().nullish(),
  client_updated_at: z.number().nullish(),
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
  client_updated_at: z.number().nullish(),
});

// No `done` field: per-user done state flows through criteria_done → user_criteria_done.
const phaseCriteriaSchema = z.object({
  id: z.string().min(1),
  phase_id: z.string().min(1),
  description: z.string().min(1),
  deleted_at: z.number().nullish(),
  client_updated_at: z.number().nullish(),
});

// Per-row outcome shipped back to the client (its outbox decides per row):
//   applied  — changes > 0; the row landed. Client deletes the queue entry.
//   stale    — changes = 0 on a data table: LWW skipped an older edit (or the row
//              isn't owned). Server state is newer; client drops the queue entry
//              and the next pull reconciles local.
//   rejected — changes = 0 on a guarded authoring table: usually a missing parent
//              (phase not pushed yet). Client retries; dead-letters after N tries.
//   invalid  — failed schema validation; will never succeed. Client dead-letters
//              immediately. One bad row no longer 400s the whole push.
type RowStatus = "applied" | "stale" | "rejected" | "invalid";

type SqlRow = Record<string, unknown>;

interface TableSpec {
  key: string;
  schema: z.ZodTypeAny;
  onZeroChanges: "stale" | "rejected";
  build: (db: D1Database, row: SqlRow, userId: string, now: number) => D1PreparedStatement;
}

// Applied in array order: parents (phases) before children (exercises, criteria)
// before per-user state (criteria_done), so a same-batch create chain resolves.
const TABLE_SPECS: TableSpec[] = [
  {
    key: "pain_checkins",
    schema: painCheckinSchema,
    onZeroChanges: "stale",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO pain_checkins (id, user_id, injury_id, date, zones, deleted_at, created_at, updated_at, client_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           zones = excluded.zones, deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE user_id = excluded.user_id
           AND (excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(pain_checkins.client_updated_at, 0))`
      ).bind(row.id, userId, row.injury_id ?? null, row.date, row.zones, row.deleted_at ?? null,
             row.created_at ?? now, now, row.client_updated_at ?? null),
  },
  {
    key: "exercise_logs",
    schema: exerciseLogSchema,
    onZeroChanges: "stale",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO exercise_logs (id, user_id, exercise_id, session_date, reps_done, pain_during, rpe, note, set_type, completed_at, deleted_at, created_at, updated_at, client_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           reps_done = excluded.reps_done, pain_during = excluded.pain_during, rpe = excluded.rpe,
           note = excluded.note, set_type = excluded.set_type,
           completed_at = excluded.completed_at, deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE user_id = excluded.user_id
           AND (excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(exercise_logs.client_updated_at, 0))`
      ).bind(row.id, userId, row.exercise_id, row.session_date, row.reps_done ?? null, row.pain_during ?? null,
             row.rpe ?? null, row.note ?? null, row.set_type ?? "normal", row.completed_at ?? null, row.deleted_at ?? null,
             row.created_at ?? now, now, row.client_updated_at ?? null),
  },
  {
    key: "sst_results",
    schema: sstResultSchema,
    onZeroChanges: "stale",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO sst_results (id, user_id, injury_id, date, strength_score, pain_score, note, deleted_at, created_at, updated_at, client_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           strength_score = excluded.strength_score, pain_score = excluded.pain_score, note = excluded.note,
           deleted_at = excluded.deleted_at, updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE user_id = excluded.user_id
           AND (excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(sst_results.client_updated_at, 0))`
      ).bind(row.id, userId, row.injury_id, row.date, row.strength_score ?? null, row.pain_score ?? null,
             row.note ?? null, row.deleted_at ?? null, row.created_at ?? now, now, row.client_updated_at ?? null),
  },
  {
    key: "prom_results",
    schema: promResultSchema,
    onZeroChanges: "stale",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO prom_results (id, user_id, injury_id, instrument_id, date, score, answers, note, deleted_at, created_at, updated_at, client_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           score = excluded.score, answers = excluded.answers, note = excluded.note,
           deleted_at = excluded.deleted_at, updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE user_id = excluded.user_id
           AND (excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(prom_results.client_updated_at, 0))`
      ).bind(row.id, userId, row.injury_id, row.instrument_id, row.date, row.score ?? null, row.answers ?? null,
             row.note ?? null, row.deleted_at ?? null, row.created_at ?? now, now, row.client_updated_at ?? null),
  },
  // Injuries: only current_phase_id + focus_days are client-editable. UPDATE-only
  // (no create) and scoped to the owner — name/zone/status/user_id never change.
  {
    key: "injuries",
    schema: injuryEditSchema,
    onZeroChanges: "stale",
    build: (db, row, userId, now) =>
      db.prepare(
        `UPDATE injuries SET current_phase_id = ?, focus_days = ?, updated_at = ?, client_updated_at = ?
         WHERE id = ? AND user_id = ?
           AND (? IS NULL OR ? >= COALESCE(client_updated_at, 0))`
      ).bind(row.current_phase_id ?? null, row.focus_days ?? null, now, row.client_updated_at ?? null,
             row.id, userId, row.client_updated_at ?? null, row.client_updated_at ?? null),
  },
  // Phases: create or edit. INSERT-SELECT guards create against non-owned injuries;
  // the conflict WHERE guards edits to phases under the user's own injuries.
  {
    key: "phases",
    schema: phaseSchema,
    onZeroChanges: "rejected",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO phases (id, injury_id, phase_num, name, description, week_start, week_end, threshold_pct, focus_days, deleted_at, created_at, updated_at, client_updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM injuries i WHERE i.id = ? AND i.user_id = ?)
         ON CONFLICT(id) DO UPDATE SET
           phase_num = excluded.phase_num, name = excluded.name, description = excluded.description,
           week_start = excluded.week_start, week_end = excluded.week_end,
           threshold_pct = excluded.threshold_pct, focus_days = excluded.focus_days,
           deleted_at = excluded.deleted_at, updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE phases.injury_id IN (SELECT id FROM injuries WHERE user_id = ?)
           AND (excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(phases.client_updated_at, 0))`
      ).bind(
        row.id, row.injury_id, row.phase_num, row.name, row.description ?? null,
        row.week_start, row.week_end, row.threshold_pct ?? 70, row.focus_days ?? null, row.deleted_at ?? null,
        now, now, row.client_updated_at ?? null,
        row.injury_id, userId, userId
      ),
  },
  // Exercises: full-row authoring. INSERT-SELECT guards create against non-owned phases;
  // the conflict WHERE guards edits to exercises under the user's own phases.
  {
    key: "exercises",
    schema: exerciseSchema,
    onZeroChanges: "rejected",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO exercises (id, phase_id, name, detail, sets, reps, duration_s, exercise_type, sort_order, video_url, created_at, updated_at, client_updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM phases p JOIN injuries i ON i.id = p.injury_id
           WHERE p.id = ? AND i.user_id = ?
         )
         ON CONFLICT(id) DO UPDATE SET
           phase_id = excluded.phase_id, name = excluded.name, detail = excluded.detail,
           sets = excluded.sets, reps = excluded.reps, duration_s = excluded.duration_s,
           exercise_type = excluded.exercise_type, sort_order = excluded.sort_order,
           video_url = excluded.video_url, updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE exercises.phase_id IN (
           SELECT p.id FROM phases p JOIN injuries i ON i.id = p.injury_id WHERE i.user_id = ?
         )
           AND (excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(exercises.client_updated_at, 0))`
      ).bind(
        row.id, row.phase_id, row.name, row.detail ?? null, row.sets ?? null, row.reps ?? null,
        row.duration_s ?? null, row.exercise_type, row.sort_order ?? 0, row.video_url ?? null,
        now, now, row.client_updated_at ?? null,
        row.phase_id, userId, userId
      ),
  },
  // Phase criteria: description authoring (never touches global `done`). Ownership via
  // phase → injury → user. INSERT defaults done=0; edits never set done.
  {
    key: "phase_criteria",
    schema: phaseCriteriaSchema,
    onZeroChanges: "rejected",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO phase_criteria (id, phase_id, description, done, deleted_at, updated_at, client_updated_at)
         SELECT ?, ?, ?, 0, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM phases p JOIN injuries i ON i.id = p.injury_id
           WHERE p.id = ? AND i.user_id = ?
         )
         ON CONFLICT(id) DO UPDATE SET
           description = excluded.description, deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE phase_criteria.phase_id IN (
           SELECT p.id FROM phases p JOIN injuries i ON i.id = p.injury_id WHERE i.user_id = ?
         )
           AND (excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(phase_criteria.client_updated_at, 0))`
      ).bind(row.id, row.phase_id, row.description, row.deleted_at ?? null, now, row.client_updated_at ?? null,
             row.phase_id, userId, userId),
  },
  // criteria_done last: the guarded SELECT (instead of a bare INSERT) means a missing
  // phase_criteria parent yields changes=0 → "rejected" + retry, NOT an FK violation
  // that would roll back the whole batch.
  {
    key: "criteria_done",
    schema: criteriaDoneSchema,
    onZeroChanges: "rejected",
    build: (db, row, userId, now) =>
      db.prepare(
        `INSERT INTO user_criteria_done (user_id, criteria_id, done, updated_at, client_updated_at)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM phase_criteria pc
           JOIN phases p ON p.id = pc.phase_id
           JOIN injuries i ON i.id = p.injury_id
           WHERE pc.id = ? AND i.user_id = ?
         )
         ON CONFLICT(user_id, criteria_id) DO UPDATE SET
           done = excluded.done, updated_at = excluded.updated_at, client_updated_at = excluded.client_updated_at
         WHERE excluded.client_updated_at IS NULL OR excluded.client_updated_at >= COALESCE(user_criteria_done.client_updated_at, 0)`
      ).bind(userId, row.criteria_id, row.done ? 1 : 0, now, row.client_updated_at ?? null,
             row.criteria_id, userId),
  },
];

// Paginated, windowed streams (drained in this order). Reference tables (injuries,
// phases, exercises, phase_criteria) ride only the first page, full delta.
const PAGE_LIMIT = 500;
const STREAMS = ["log_day_counts", "exercise_logs", "pain_checkins", "sst_results", "prom_results"] as const;
type Stream = typeof STREAMS[number];

// ws = windowStart frozen on the first page so a pull spanning midnight doesn't
// shift the window between pages.
type Cursor = { s: number; ua: number; id: string; ws: string };

// Fetch up to `limit` rows of a paginated stream. `cua`/`cid` are the keyset
// position (updated_at, id); the first page of a stream starts at (since, "").
async function queryStream(
  db: D1Database, name: Stream, userId: string, since: number,
  windowStart: string, cua: number, cid: string, limit: number,
): Promise<Record<string, unknown>[]> {
  if (name === "log_day_counts") {
    // Materialized rollup (maintained on push): one row per (exercise, day).
    const r = await db.prepare(
      `SELECT user_id, exercise_id, session_date, sets, updated_at
       FROM log_day_counts
       WHERE user_id = ? AND updated_at > ?
         AND ( updated_at > ?
               OR (updated_at = ? AND exercise_id || '|' || session_date > ?) )
       ORDER BY updated_at, exercise_id, session_date
       LIMIT ?`
    ).bind(userId, since, cua, cua, cid, limit).all();
    return r.results as Record<string, unknown>[];
  }
  // Raw rows, capped to the recent window. `name` is from the fixed STREAMS list.
  const dateCol = name === "exercise_logs" ? "session_date" : "date";
  const r = await db.prepare(
    `SELECT * FROM ${name}
     WHERE user_id = ? AND updated_at > ? AND ${dateCol} >= ?
       AND ( updated_at > ? OR (updated_at = ? AND id > ?) )
     ORDER BY updated_at, id LIMIT ?`
  ).bind(userId, since, windowStart, cua, cua, cid, limit).all();
  return r.results as Record<string, unknown>[];
}

function rowKey(name: Stream, row: Record<string, unknown>): string {
  return name === "log_day_counts"
    ? `${row.exercise_id}|${row.session_date}`
    : String(row.id);
}

// GET /sync/pull?since=<unix_ms>&windowDays=<n>&cursor=<token>
// Delta pull. Reference tables on the first page; raw logs/checkins/sst windowed
// to the last `windowDays`; the all-time rollup keeps progress correct. The client
// loops the cursor until `done`.
const HISTORY_TABLES = ["exercise_logs", "pain_checkins", "sst_results"] as const;

sync.get("/pull", async (c) => {
  const userId = c.get("userId");

  // On-demand history: raw rows for one day outside the sync window. Ignores the
  // `since` watermark and never advances it — purely a cache fill for old data.
  if (c.req.query("mode") === "history") {
    const table = c.req.query("table");
    const date = c.req.query("date");
    if (!date || !HISTORY_TABLES.includes(table as typeof HISTORY_TABLES[number])) {
      return c.json({ error: "bad history request" }, 400);
    }
    const dateCol = table === "exercise_logs" ? "session_date" : "date";
    const r = await c.env.DB.prepare(
      `SELECT * FROM ${table} WHERE user_id = ? AND ${dateCol} = ?`
    ).bind(userId, date).all();
    return c.json({ [table as string]: r.results });
  }

  const since = Number(c.req.query("since") ?? 0);
  const windowDays = Number(c.req.query("windowDays") ?? 120);
  const cursorRaw = c.req.query("cursor");

  const isFirstPage = !cursorRaw;
  let cur: Cursor = {
    s: 0, ua: since, id: "",
    ws: new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10),
  };
  if (cursorRaw) {
    try {
      cur = JSON.parse(atob(cursorRaw)) as Cursor;
      if (typeof cur.ws !== "string") throw new Error("missing ws");
    } catch { return c.json({ error: "bad cursor" }, 400); }
  }
  const windowStart = cur.ws;

  const payload: Record<string, unknown> = { serverTime: Date.now() };

  // Reference tables: small, full delta, first page only.
  if (isFirstPage) {
    const [injuries, phases, exercises, phaseCriteria, promInstruments] = await Promise.all([
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
      // Global reference content (not user-scoped): every client gets the same instruments.
      c.env.DB.prepare(
        `SELECT * FROM prom_instruments WHERE updated_at > ?`
      ).bind(since).all(),
    ]);
    payload.injuries = injuries.results;
    payload.phases = phases.results;
    payload.exercises = exercises.results;
    payload.phase_criteria = phaseCriteria.results;
    payload.prom_instruments = promInstruments.results;
  }

  // Drain streams in order against one page budget: a small dataset finishes in a
  // single request, while a deep history splits across requests bounded by PAGE_LIMIT.
  // The cursor parks on whichever stream consumed the budget; a drained stream just
  // advances to the next one's start (ua=since, id="").
  let s = cur.s, ua = cur.ua, id = cur.id;
  let budget = PAGE_LIMIT;
  let nextCursor: string | null = null;

  while (s < STREAMS.length) {
    const name = STREAMS[s];
    const rows = await queryStream(c.env.DB, name, userId, since, windowStart, ua, id, budget);
    payload[name] = rows;
    if (rows.length === budget) {
      const last = rows[rows.length - 1];
      nextCursor = btoa(JSON.stringify({ s, ua: Number(last.updated_at), id: rowKey(name, last), ws: windowStart }));
      break;
    }
    budget -= rows.length;
    s++; ua = since; id = "";
  }

  payload.nextCursor = nextCursor;
  payload.done = nextCursor === null;
  return c.json(payload);
});

// POST /sync/push
// Upserts local rows into D1. Validation is per row (one bad row no longer rejects
// the request) and the response reports a per-row status so the client's outbox can
// delete / retry / dead-letter each queue entry individually.
sync.post("/push", async (c) => {
  const userId = c.get("userId");
  const raw: unknown = await c.req.json().catch(() => null);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return c.json({ error: "invalid body" }, 400);
  }
  const body = raw as Record<string, unknown>;

  const now = Date.now();
  const db = c.env.DB;

  const statements: D1PreparedStatement[] = [];
  // Maps each batch statement back to (table, row index); null = rollup bookkeeping.
  const stmtMeta: Array<{ key: string; idx: number } | null> = [];
  const results: Record<string, RowStatus[]> = {};
  const policy: Record<string, "stale" | "rejected"> = {};
  // Distinct (exercise, day) groups touched by this push → rollup recompute.
  const logGroups = new Map<string, { exercise_id: string; session_date: string }>();

  for (const spec of TABLE_SPECS) {
    const rows = body[spec.key];
    if (!Array.isArray(rows)) continue;
    if (rows.length > MAX_ROWS) {
      return c.json({ error: `${spec.key} exceeds ${MAX_ROWS} rows` }, 400);
    }
    policy[spec.key] = spec.onZeroChanges;
    const statuses: RowStatus[] = new Array(rows.length).fill("invalid") as RowStatus[];
    results[spec.key] = statuses;
    rows.forEach((rawRow, idx) => {
      const parsed = spec.schema.safeParse(rawRow);
      if (!parsed.success) return; // stays "invalid"
      const row = parsed.data as SqlRow;
      stmtMeta.push({ key: spec.key, idx });
      statements.push(spec.build(db, row, userId, now));
      if (spec.key === "exercise_logs") {
        const g = row as { exercise_id: string; session_date: string };
        logGroups.set(`${g.exercise_id}|${g.session_date}`, g);
      }
    });
  }

  // Recompute the rollup for every touched group AFTER the log upserts (same batch,
  // sequential): reads the post-upsert table state, so retries/LWW skips stay correct.
  for (const g of logGroups.values()) {
    stmtMeta.push(null);
    statements.push(
      db.prepare(
        `INSERT INTO log_day_counts (user_id, exercise_id, session_date, sets, updated_at)
         VALUES (?, ?, ?,
           (SELECT COUNT(*) FROM exercise_logs
            WHERE user_id = ? AND exercise_id = ? AND session_date = ? AND deleted_at IS NULL
              AND set_type != 'warmup'),
           ?)
         ON CONFLICT(user_id, exercise_id, session_date) DO UPDATE SET
           sets = excluded.sets, updated_at = excluded.updated_at`
      ).bind(userId, g.exercise_id, g.session_date,
             userId, g.exercise_id, g.session_date, now)
    );
  }

  let synced = 0;
  if (statements.length > 0) {
    const outcomes = await db.batch(statements);
    outcomes.forEach((res, i) => {
      const meta = stmtMeta[i];
      if (!meta) return;
      const applied = (res.meta?.changes ?? 0) > 0;
      results[meta.key][meta.idx] = applied ? "applied" : policy[meta.key];
      if (applied) synced++;
    });
  }

  return c.json({ synced, serverTime: now, results });
});

export default sync;
