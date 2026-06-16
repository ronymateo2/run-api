-- Removes the Web Push reminders feature (hourly cron retired).
DROP TABLE IF EXISTS push_subscriptions;
ALTER TABLE users DROP COLUMN reminder_enabled;
ALTER TABLE users DROP COLUMN reminder_hour;
ALTER TABLE users DROP COLUMN reminder_last_date;
