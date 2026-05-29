import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import syncRoutes from "./routes/sync";
import phasesRoutes from "./routes/phases";
import learnRoutes from "./routes/learn";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  return cors({
    origin: c.env.ALLOWED_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })(c, next);
});

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/phases", phasesRoutes);
app.route("/api/learn", learnRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
