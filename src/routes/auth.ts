import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SignJWT } from "jose";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30d, matches JWT expiry

const googleAuthSchema = z.object({
  id_token: z.string().min(1),
});

type Bindings = Env;

const auth = new Hono<{ Bindings: Bindings }>();

async function verifyGoogleToken(idToken: string, clientId: string) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!res.ok) throw new Error("Invalid Google token");
  const payload = await res.json() as {
    sub: string; email: string; name: string; picture: string; aud: string;
    iss: string; email_verified: string | boolean;
  };
  if (payload.aud !== clientId) throw new Error("Token audience mismatch");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss))
    throw new Error("Invalid token issuer");
  if (payload.email_verified !== "true" && payload.email_verified !== true)
    throw new Error("Email not verified");
  return payload;
}

async function signJwt(
  payload: { sub: string; email: string },
  secret: string,
  expiresIn = "30d"
) {
  const secretKey = new TextEncoder().encode(secret);
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
}

auth.post(
  "/google",
  // Rate limit before parsing so junk floods get throttled cheaply.
  async (c, next) => {
    const limiter = (c.env as Env & { AUTH_RATE_LIMITER?: RateLimit }).AUTH_RATE_LIMITER;
    if (limiter) {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const { success } = await limiter.limit({ key: ip });
      if (!success) return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  },
  zValidator("json", googleAuthSchema),
  async (c) => {
  const { id_token } = c.req.valid("json");

  let googlePayload;
  try {
    googlePayload = await verifyGoogleToken(id_token, c.env.GOOGLE_CLIENT_ID);
  } catch {
    return c.json({ error: "Invalid Google token" }, 401);
  }

  const { sub: googleSub, email, name, picture } = googlePayload;
  const now = Date.now();

  // Find existing provider link
  const existing = await c.env.DB.prepare(
    `SELECT u.* FROM users u
     JOIN user_auth_providers p ON p.user_id = u.id
     WHERE p.provider = 'google' AND p.provider_sub = ?`
  ).bind(googleSub).first<{ id: string; email: string; name: string; timezone: string | null }>();

  let userId: string;

  if (existing) {
    userId = existing.id;
    // Update name/avatar if changed
    await c.env.DB.prepare(
      `UPDATE users SET name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`
    ).bind(name, picture, now, userId).run();
  } else {
    // Create user + auth provider link
    userId = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(userId, email, name, picture, now, now),
      c.env.DB.prepare(
        `INSERT INTO user_auth_providers (id, user_id, provider, provider_sub, created_at)
         VALUES (?, ?, 'google', ?, ?)`
      ).bind(crypto.randomUUID(), userId, googleSub, now),
    ]);
  }

  const token = await signJwt({ sub: userId, email }, c.env.JWT_SECRET);

  // Primary transport: httpOnly cookie (not readable by JS → no XSS token theft).
  // SameSite=None + Secure so it is sent on cross-site requests from the web app.
  setCookie(c, "token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return c.json({
    user: { id: userId, email, name, avatar_url: picture, timezone: existing?.timezone ?? null },
  });
});

auth.post("/logout", (c) => {
  setCookie(c, "token", "", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge: 0,
  });
  return c.json({ ok: true });
});

export default auth;
