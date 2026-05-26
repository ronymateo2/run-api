import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";

export type JwtPayload = { sub: string; email: string };

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string; email: string };
}>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = header.slice(7);
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    c.set("userId", payload.sub as string);
    c.set("email", payload.email as string);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});
