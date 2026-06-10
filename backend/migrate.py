"""SQLite → PostgreSQL 数据迁移脚本。

用法：
    cd backend
    python migrate.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import psycopg

V12_DB = r"D:\workspace_py\Home Theater v1.2\backend\data\app.db"
ENV_FILE = Path(__file__).parent / ".env"


def _parse_db_url() -> dict:
    """从 .env 解析 DATABASE_URL。"""
    url = None
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
                break
    if not url:
        raise RuntimeError(".env 中未找到 DATABASE_URL")
    p = urlparse(url.replace("postgresql+asyncpg://", "postgresql://", 1))
    return {
        "host": p.hostname or "localhost",
        "port": p.port or 5432,
        "user": p.username,
        "password": p.password,
        "dbname": p.path.lstrip("/"),
    }


def _connect_pg():
    cfg = _parse_db_url()
    return psycopg.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        dbname=cfg["dbname"],
    )


def _sqlite_bool(val) -> bool | None:
    if val is None:
        return None
    return bool(val)


def _sqlite_json(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, str):
        return val
    return json.dumps(val, ensure_ascii=False)


def _truncate(pg: psycopg.Connection, table: str):
    with pg.cursor() as c:
        c.execute(f"TRUNCATE TABLE {table} CASCADE")
    pg.commit()


def migrate_system_categories(pg: psycopg.Connection, lite: sqlite3.Connection):
    print("Migrating system_categories...")
    cur = lite.execute("SELECT id, parent_id, name, sort, created_at FROM system_categories")
    rows = cur.fetchall()
    if not rows:
        return
    with pg.cursor() as c:
        c.executemany(
            "INSERT INTO system_categories (id, parent_id, name, sort, created_at) VALUES (%s, %s, %s, %s, %s)",
            rows,
        )
    pg.commit()
    print(f"  → {len(rows)} rows")


def migrate_sites(pg: psycopg.Connection, lite: sqlite3.Connection):
    print("Migrating sites...")
    cur = lite.execute(
        "SELECT id, name, base_url, enabled, sort, categories, auto_disabled_at, created_at FROM sites"
    )
    rows = []
    for r in cur.fetchall():
        rows.append((
            r[0], r[1], r[2], _sqlite_bool(r[3]), r[4],
            _sqlite_json(r[5]), r[6], r[7],
        ))
    if not rows:
        return
    with pg.cursor() as c:
        c.executemany(
            "INSERT INTO sites (id, name, base_url, enabled, sort, categories, auto_disabled_at, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)",
            rows,
        )
    pg.commit()
    print(f"  → {len(rows)} rows")


def migrate_favorites(pg: psycopg.Connection, lite: sqlite3.Connection):
    print("Migrating favorites...")
    cur = lite.execute("SELECT id, title, year, poster_url, created_at, sources FROM favorites")
    rows = []
    for r in cur.fetchall():
        rows.append((r[0], r[1], r[2], r[3], r[4], _sqlite_json(r[5])))
    if not rows:
        return
    with pg.cursor() as c:
        c.executemany(
            "INSERT INTO favorites (id, title, year, poster_url, created_at, sources) VALUES (%s, %s, %s, %s, %s, %s::jsonb)",
            rows,
        )
    pg.commit()
    print(f"  → {len(rows)} rows")


def migrate_play_progress(pg: psycopg.Connection, lite: sqlite3.Connection):
    print("Migrating play_progress...")
    cur = lite.execute(
        "SELECT id, title, year, source_site_id, source_video_id, episode_index, episode_name, "
        "position_seconds, duration_seconds, updated_at FROM play_progress"
    )
    rows = cur.fetchall()
    if not rows:
        return
    with pg.cursor() as c:
        c.executemany(
            "INSERT INTO play_progress (id, title, year, source_site_id, source_video_id, episode_index, "
            "episode_name, position_seconds, duration_seconds, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            rows,
        )
    pg.commit()
    print(f"  → {len(rows)} rows")


def migrate_download_tasks(pg: psycopg.Connection, lite: sqlite3.Connection):
    print("Migrating download_tasks...")
    cur = lite.execute(
        "SELECT id, title, episode_index, episode_name, source_site_id, source_video_id, url, suffix, "
        "file_path, total_bytes, downloaded_bytes, total_segments, downloaded_segments, status, error, "
        "created_at, updated_at FROM download_tasks"
    )
    rows = cur.fetchall()
    if not rows:
        return
    with pg.cursor() as c:
        c.executemany(
            "INSERT INTO download_tasks (id, title, episode_index, episode_name, source_site_id, source_video_id, "
            "url, suffix, file_path, total_bytes, downloaded_bytes, total_segments, downloaded_segments, "
            "status, error, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            rows,
        )
    pg.commit()
    print(f"  → {len(rows)} rows")


def migrate_app_config(pg: psycopg.Connection, lite: sqlite3.Connection):
    print("Migrating app_config...")
    cur = lite.execute("SELECT key, value, updated_at FROM app_config")
    rows = cur.fetchall()
    if not rows:
        return
    # 跳过 SQLite 双缓冲相关的 key
    skip_keys = {"aggregated_active_version"}
    filtered = [r for r in rows if r[0] not in skip_keys]
    with pg.cursor() as c:
        c.executemany(
            "INSERT INTO app_config (key, value, updated_at) VALUES (%s, %s, %s)",
            filtered,
        )
    pg.commit()
    print(f"  → {len(filtered)} rows")


def migrate_video_cache(pg: psycopg.Connection, lite: sqlite3.Connection):
    print("Migrating video_cache (this may take a few minutes)...")
    cur = lite.execute(
        "SELECT id, site_id, original_id, title, year, poster_url, intro, area, actors, director, "
        "play_url_raw, source_updated_at, cached_at, type_id, type_name, remarks, play_from, has_detail "
        "FROM video_cache"
    )

    total = 0
    batch = []
    BATCH_SIZE = 5000

    with pg.cursor() as c:
        # 先准备 COPY
        with c.copy(
            "COPY video_cache (id, site_id, original_id, title, year, poster_url, intro, area, actors, "
            "director, play_url_raw, source_updated_at, cached_at, type_id, type_name, remarks, play_from, "
            "has_detail, search_vector) FROM STDIN"
        ) as copy:
            for row in cur:
                copy.write_row((*row, None))  # search_vector = NULL
                total += 1
                if total % BATCH_SIZE == 0:
                    print(f"  ... {total} rows", end="\r")

    pg.commit()
    print(f"  → {total} rows")


def main():
    print(f"Source: {V12_DB}")
    print(f"Target: {_parse_db_url()['dbname']} @ {_parse_db_url()['host']}")
    print()

    lite = sqlite3.connect(V12_DB)
    lite.row_factory = sqlite3.Row
    pg = _connect_pg()

    # 确认目标表为空（或选择覆盖）
    with pg.cursor() as c:
        c.execute("SELECT COUNT(*) FROM video_cache")
        count = c.fetchone()[0]
        if count > 0:
            print(f"WARNING: video_cache already has {count} rows. Migration will append duplicates!")
            ans = input("Continue anyway? [y/N]: ")
            if ans.lower() != "y":
                print("Aborted.")
                return

    # 按外键依赖逆序清空目标表
    for tbl in ["video_cache", "play_progress", "favorites", "download_tasks", "app_config", "sites", "system_categories"]:
        _truncate(pg, tbl)

    migrate_system_categories(pg, lite)
    migrate_sites(pg, lite)
    migrate_favorites(pg, lite)
    migrate_play_progress(pg, lite)
    migrate_download_tasks(pg, lite)
    migrate_app_config(pg, lite)
    migrate_video_cache(pg, lite)

    print("\nDone. Remember to run: REFRESH MATERIALIZED VIEW mv_aggregated_videos;")

    lite.close()
    pg.close()


if __name__ == "__main__":
    main()
