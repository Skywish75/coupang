-- Telegram subscribers for weekly lotto numbers (worker/lib/telegram.js).
-- The Worker also creates this table on first use, so applying this file
-- by hand is optional.
CREATE TABLE IF NOT EXISTS lotto_subscribers (
  chat_id INTEGER PRIMARY KEY,
  subscribed_at TEXT NOT NULL,
  last_round INTEGER NOT NULL DEFAULT 0,
  last_games TEXT
);
