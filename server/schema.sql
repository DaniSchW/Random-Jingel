-- Random Jingle - MySQL/MariaDB schema for the self-hosted (All-Inkl) backend
-- that replaces Supabase (Auth + Postgres + Storage + RLS).
--
-- Run this once against the All-Inkl database (e.g. via phpMyAdmin in KAS,
-- or `mysql -u <dbname> -p <dbname> < server/schema.sql`). Safe to re-run:
-- every statement uses IF NOT EXISTS / idempotent guards.
--
-- Design notes (mirrors supabase/schema.sql where the concepts carry over):
-- - Ids are client-generated UUIDs (CHAR(36)) so the same id is used in
--   IndexedDB and here, keeping sync a simple upsert-by-id.
-- - updated_at is set and trusted client-side (device clock) on purpose:
--   it is the timestamp Last-Write-Wins compares against. No trigger here
--   overrides it (matches the Supabase schema's own comment on this).
-- - There is no Row Level Security here - MySQL has no equivalent. Every
--   PHP endpoint in server/api/ MUST filter explicitly on the
--   authenticated user_id from the session; that filtering IS the
--   security boundary now, not a database feature.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY users_email_uk (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Magic-link request tokens: single-use, short-lived. token_hash stores
-- SHA-256(token) - the raw token only ever exists in the emailed URL and
-- briefly in transit, never at rest, so a DB read alone can't be used to
-- sign in as someone.
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Long-lived session tokens (the client's Authorization: Bearer value).
-- Same hashed-at-rest treatment as auth_tokens.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Simple per-email/IP rate limiting for auth_tokens issuance, since PHP
-- mail() has no built-in throttling and this endpoint is unauthenticated
-- by nature (anyone can request a link for any email).
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bucket_key VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX auth_rate_limits_bucket_idx ON auth_rate_limits (bucket_key, created_at);

CREATE TABLE IF NOT EXISTS categories (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(32) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  playback_mode ENUM('random', 'sequential') NOT NULL DEFAULT 'random',
  sequential_index INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT categories_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX categories_user_id_idx ON categories (user_id);

CREATE TABLE IF NOT EXISTS jingles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  category_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(32) NULL,
  storage_path VARCHAR(500) NULL,
  mime_type VARCHAR(100) NULL,
  file_name VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME(3) NULL,
  trim_start DOUBLE NULL,
  trim_end DOUBLE NULL,
  hotkey VARCHAR(10) NULL,
  source_note TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT jingles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT jingles_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX jingles_user_id_idx ON jingles (user_id);
CREATE INDEX jingles_category_id_idx ON jingles (category_id);

-- One row per user: their preferred UI language. Same client-timestamp
-- Last-Write-Wins convention as categories/jingles.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  language VARCHAR(5) NOT NULL DEFAULT 'de',
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT user_settings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One-time: promote a specific account to admin once they've signed in at
-- least once (this is a no-op / 0 rows affected until then - re-run after
-- their first login). Mirrors the same line at the bottom of
-- supabase/schema.sql.
UPDATE users SET role = 'admin' WHERE email = 'service@web-schwarz.de';
