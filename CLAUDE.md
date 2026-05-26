# Rurana — run-api

Cloudflare Worker + Hono + D1. Auth, sync, and phase data for the Rurana PWA.

## Stack
- Cloudflare Workers (ES modules)
- Hono 4 — routing + middleware
- D1 — SQLite-compatible serverless DB
- `jose` — JWT sign/verify (Web Crypto API, works in Workers)

## Routes
```
POST /api/auth/google       { id_token } → { token, user }
GET  /api/users/me          → { user }         (auth required)
GET  /api/sync/pull?since=  → delta payload    (auth required)
POST /api/sync/push         { pain_checkins, exercise_logs, sst_results } (auth required)
GET  /api/phases            → { injuries, phases } (auth required)
GET  /health                → { ok: true }
```

## Auth
- Verifies Google `id_token` via `https://oauth2.googleapis.com/tokeninfo`
- Upserts `users` + `user_auth_providers` (provider='google')
- Returns own JWT (HS256, 30d expiry)
- `authMiddleware` in `src/middleware/auth.ts` — sets `userId` + `email` in context

## Multi-provider support
`user_auth_providers` table: (user_id, provider, provider_sub). Add rows for other providers without changing `users` table.

## Schema
`src/db/schema.sql` — run migrations:
```bash
npm run db:migrate:local   # local D1
npm run db:migrate         # production D1
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
