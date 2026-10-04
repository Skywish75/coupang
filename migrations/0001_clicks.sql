-- One row per (KST day, affiliate slug, page the click came from).
CREATE TABLE IF NOT EXISTS clicks (
  day TEXT NOT NULL,
  slug TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, slug, page)
);
CREATE INDEX IF NOT EXISTS clicks_slug ON clicks (slug);
