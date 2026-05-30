import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
const learn = new Hono();
learn.use("*", authMiddleware);
learn.get("/", async (c) => {
    const rows = await c.env.DB.prepare(`SELECT * FROM articles ORDER BY sort_order ASC, published_at DESC`).all();
    return c.json({ articles: rows.results });
});
export default learn;
