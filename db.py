import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "bookmarks.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    parent_id  INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category_id);

CREATE TABLE IF NOT EXISTS developers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    github_url  TEXT    NOT NULL,
    blog_url    TEXT,
    twitter_url TEXT,
    avatar_url  TEXT,
    reason      TEXT    NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


def _migrate_developers(conn) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(developers)").fetchall()}
    if not cols:
        return
    if "url" in cols and "github_url" not in cols:
        conn.execute("ALTER TABLE developers RENAME COLUMN url TO github_url")
    if "blog_url" not in cols:
        conn.execute("ALTER TABLE developers ADD COLUMN blog_url TEXT")
    if "twitter_url" not in cols:
        conn.execute("ALTER TABLE developers ADD COLUMN twitter_url TEXT")


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    with connect() as db:
        db.executescript(SCHEMA)
        _migrate_developers(db)
        db.commit()
