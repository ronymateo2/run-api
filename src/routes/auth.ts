import { Hono } from "hono";
import { SignJWT } from "jose";


type Bindings = Env;

const auth = new Hono<{ Bindings: Bindings }>();

async function verifyGoogleToken(idToken: string, clientId: string) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
  );
  if (!res.ok) throw new Error("Invalid Google token");
  const payload = await res.json() as {
    sub: string; email: string; name: string; picture: string; aud: string;
  };
  if (payload.aud !== clientId) throw new Error("Token audience mismatch");
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

auth.post("/google", async (c) => {
  const { id_token } = await c.req.json<{ id_token: string }>();
  if (!id_token) return c.json({ error: "Missing id_token" }, 400);

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
  ).bind(googleSub).first<{ id: string; email: string; name: string }>();

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

  return c.json({
    token,
    user: { id: userId, email, name, avatar_url: picture },
  });
});

export default auth;
