import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import syncRoutes from "./routes/sync";
import phasesRoutes from "./routes/phases";
import learnRoutes from "./routes/learn";
import pushRoutes from "./routes/push";
import { runReminders } from "./lib/reminders";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  return cors({
    origin: c.env.ALLOWED_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })(c, next);
});

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/phases", phasesRoutes);
app.route("/api/learn", learnRoutes);
app.route("/api/push", pushRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

// Hourly cron (wrangler.toml [triggers]) drives reminder delivery.
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runReminders(env));
  },
};
