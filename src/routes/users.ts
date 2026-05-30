import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";

const users = new Hono<{ Bindings: Env; Variables: { userId: string; email: string } }>();

users.use("*", authMiddleware);

// IANA tz names: letters/digits and / _ + - separators (e.g. "America/Santo_Domingo", "UTC").
const patchUserSchema = z.object({
  timezone: z.string().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/),
});

users.get("/me", async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare(
    `SELECT id, email, name, avatar_url, timezone, created_at FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user });
});

users.patch("/me", zValidator("json", patchUserSchema), async (c) => {
  const userId = c.get("userId");
  const { timezone } = c.req.valid("json");
  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?`
  ).bind(timezone, now, userId).run();
  return c.json({ ok: true });
});

export default users;
