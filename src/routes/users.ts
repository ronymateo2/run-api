import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";

const users = new Hono<{ Bindings: Env; Variables: { userId: string; email: string } }>();

users.use("*", authMiddleware);

users.get("/me", async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare(
    `SELECT id, email, name, avatar_url, timezone, created_at FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user });
});

users.patch("/me", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ timezone?: string }>();
  if (!body.timezone) return c.json({ error: "Missing timezone" }, 400);
  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?`
  ).bind(body.timezone, now, userId).run();
  return c.json({ ok: true });
});

export default users;
