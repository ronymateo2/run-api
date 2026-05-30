# Rurana — run-api

Cloudflare Worker + Hono + D1. Auth, sync, and phase data for the Rurana PWA.

## Stack
- Cloudflare Workers (ES modules)
- Hono 4 — routing + middleware
- D1 — SQLite-compatible serverless DB
- `jose` — JWT sign/verify (Web Crypto API, works in Workers)

## Routes
```
POST /api/auth/google       { id_token } → { user }   (sets httpOnly session cookie)
POST /api/auth/logout       → { ok }               (clears session cookie)
GET  /api/users/me          → { user }         (auth required)
GET  /api/sync/pull?since=  → delta payload    (auth required)
POST /api/sync/push         { pain_checkins, exercise_logs, sst_results } (auth required)
GET  /api/phases            → { injuries, phases } (auth required)
GET  /health                → { ok: true }
```

## Auth
- Verifies Google `id_token` via `https://oauth2.googleapis.com/tokeninfo`
- Upserts `users` + `user_auth_providers` (provider='google')
- Issues own JWT (HS256, 30d) delivered as an **httpOnly + Secure + SameSite=None cookie** (`token`) — not readable by JS, so no XSS token theft
- `authMiddleware` in `src/middleware/auth.ts` — reads the cookie first, falls back to `Authorization: Bearer`; sets `userId` + `email` in context
- `jwtVerify` pinned to `algorithms: ["HS256"]`
- `POST /api/auth/google` rate-limited (10/60s per IP) via the `AUTH_RATE_LIMITER` binding (`wrangler.toml`)
- CORS `credentials: true`, origin pinned to `ALLOWED_ORIGIN`

## Multi-provider support
`user_auth_providers` table: (user_id, provider, provider_sub). Add rows for other providers without changing `users` table.

## Schema
Migrations live in `migrations/` (wrangler D1 format). `src/db/schema.sql` is reference only.

Add new migrations as `migrations/NNNN_description.sql`, then run:
```bash
npm run db:migrate:local    # local D1
npm run db:migrate:remote   # production D1
```

## Env / wrangler.toml
```toml
[[d1_databases]]
binding = "DB"
database_name = "rurana-db"
database_id = "<from: wrangler d1 create rurana-db>"

[vars]
JWT_SECRET = "<random 32+ char string>"
GOOGLE_CLIENT_ID = "<from Google Cloud Console>"
```

## Dev
```bash
npm run dev    # wrangler dev at localhost:8787
```

## Key notes
- Injuries/phases/exercises are admin-seeded directly in D1 (no API for it)
- Phase gating (70% threshold) enforced client-side; server is source of truth for progress data
- `synced` column exists only in local SQLite (run-web), not in D1 schema

# Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

##  Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

##  Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

##  Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
