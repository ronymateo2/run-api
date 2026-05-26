import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import syncRoutes from "./routes/sync";
import phasesRoutes from "./routes/phases";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "https://run-web.workers.dev"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/phases", phasesRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
