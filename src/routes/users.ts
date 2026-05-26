import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";

const users = new Hono<{ Bindings: Env; Variables: { userId: string; email: string } }>();

users.use("*", authMiddleware);

users.get("/me", async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare(
    `SELECT id, email, name, avatar_url, created_at FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user });
});

export default users;
