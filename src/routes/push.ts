import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";

type Variables = { userId: string; email: string };

const push = new Hono<{ Bindings: Env; Variables: Variables }>();
push.use("*", authMiddleware);

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

// Register/refresh this device's subscription and turn the master switch on.
push.post(
  "/subscribe",
  zValidator("json", z.object({ subscription: subscriptionSchema, reminder_hour: z.number().int().min(0).max(23).optional() })),
  async (c) => {
    const userId = c.get("userId");
    const { subscription, reminder_hour } = c.req.valid("json");
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now).run();
    await c.env.DB.prepare(
      `UPDATE users SET reminder_enabled = 1, reminder_hour = COALESCE(?, reminder_hour, 8), updated_at = ? WHERE id = ?`,
    ).bind(reminder_hour ?? null, now, userId).run();
    return c.json({ ok: true });
  },
);

// Drop this device; disable the switch when the user has no devices left.
push.post("/unsubscribe", zValidator("json", z.object({ endpoint: z.string().min(1) })), async (c) => {
  const userId = c.get("userId");
  const { endpoint } = c.req.valid("json");
  await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`).bind(endpoint, userId).run();
  await c.env.DB.prepare(
    `UPDATE users SET reminder_enabled = (SELECT CASE WHEN EXISTS(SELECT 1 FROM push_subscriptions WHERE user_id = ?) THEN 1 ELSE 0 END), updated_at = ? WHERE id = ?`,
  ).bind(userId, Date.now(), userId).run();
  return c.json({ ok: true });
});

push.patch("/prefs", zValidator("json", z.object({ reminder_hour: z.number().int().min(0).max(23) })), async (c) => {
  const userId = c.get("userId");
  const { reminder_hour } = c.req.valid("json");
  await c.env.DB.prepare(`UPDATE users SET reminder_hour = ?, updated_at = ? WHERE id = ?`).bind(reminder_hour, Date.now(), userId).run();
  return c.json({ ok: true });
});

push.get("/prefs", async (c) => {
  const userId = c.get("userId");
  const row = await c.env.DB.prepare(`SELECT reminder_enabled, reminder_hour FROM users WHERE id = ?`).bind(userId)
    .first<{ reminder_enabled: number; reminder_hour: number }>();
  return c.json({ reminder_enabled: !!row?.reminder_enabled, reminder_hour: row?.reminder_hour ?? 8 });
});

export default push;
