import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { jwtVerify } from "jose";

export type JwtPayload = { sub: string; email: string };

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string; email: string };
}>(async (c, next) => {
  // Prefer the httpOnly cookie; fall back to Authorization header for other clients.
  const cookieToken = getCookie(c, "token");
  const header = c.req.header("Authorization");
  const token = cookieToken ?? (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    c.set("userId", payload.sub as string);
    c.set("email", payload.email as string);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});
