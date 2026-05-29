CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  content TEXT,
  notion_url TEXT,
  tags TEXT,
  published_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
