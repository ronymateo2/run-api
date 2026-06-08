// Runs on the hourly cron. Sends a push to users whose local hour == their reminder
// hour, where today is a focus day for an active injury, deduped per local day.
import { sendWebPush, type PushSub } from "./webpush";

interface DueUser {
  id: string;
  timezone: string | null;
  reminder_hour: number | null;
  reminder_last_date: string | null;
}

function localParts(tz: string): { hour: number; weekday: string; date: string } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false, hourCycle: "h23" }).format(now),
  );
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
    .format(now).toLowerCase(); // "mon", "tue", …
  const date = now.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  return { hour, weekday, date };
}

export async function runReminders(env: Env): Promise<void> {
  const users = await env.DB.prepare(
    `SELECT DISTINCT u.id, u.timezone, u.reminder_hour, u.reminder_last_date
     FROM users u
     JOIN push_subscriptions ps ON ps.user_id = u.id
     WHERE u.reminder_enabled = 1`,
  ).all<DueUser>();

  for (const u of users.results) {
    const tz = u.timezone || "UTC";
    const { hour, weekday, date } = localParts(tz);
    if (hour !== (u.reminder_hour ?? 8)) continue;
    if (u.reminder_last_date === date) continue; // already sent today

    // Today a focus day for any active injury? Phase focus_days overrides the injury's;
    // a null means "no restriction" → every day counts.
    const focus = await env.DB.prepare(
      `SELECT COALESCE(p.focus_days, i.focus_days) AS fd
       FROM injuries i
       LEFT JOIN phases p ON p.id = i.current_phase_id
       WHERE i.user_id = ? AND i.status = 'active'`,
    ).bind(u.id).all<{ fd: string | null }>();

    if (focus.results.length === 0) continue;
    const isFocusDay = focus.results.some((r) => {
      if (!r.fd) return true;
      try { return (JSON.parse(r.fd) as string[]).includes(weekday); } catch { return false; }
    });
    if (!isFocusDay) continue;

    const subs = await env.DB.prepare(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
    ).bind(u.id).all<PushSub>();

    const payload = { title: "Hora de tu rehabilitación 🌱", body: "Tus ejercicios de hoy te esperan.", url: "/today" };
    let sent = false;
    for (const s of subs.results) {
      try {
        const status = await sendWebPush(s, payload, env);
        if (status >= 200 && status < 300) sent = true;
        else if (status === 404 || status === 410) {
          await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(s.endpoint).run();
        } else {
          console.error("[push] unexpected status", status, "endpoint", s.endpoint.slice(0, 50));
        }
      } catch (e) {
        console.error("[push] send failed", e);
      }
    }
    // Only mark done if a push actually landed — otherwise a failed hour would
    // dedup itself out and never retry.
    if (sent) {
      await env.DB.prepare(`UPDATE users SET reminder_last_date = ? WHERE id = ?`).bind(date, u.id).run();
    }
  }
}
