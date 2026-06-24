# Backend Bug List — Home Theater v2

> Scope: `backend/app/main.py`, `models.py`, `schemas.py`, `db.py`, `config.py`, `constants.py`, `api/*.py`, `services/*.py`.  
> This is a read-only review; no files were modified.

> **状态更新（2026-06-23）**：经复核，此前标记为【已修复】的条目已全部从列表中移除；剩余条目仍为待修复项，需结合当前 PG-only 分支策略继续推进。

---

## Critical

### 1. SQLite startup is broken because models use PostgreSQL-only column types
- **File:** `backend/app/models.py`
- **Lines:** 5 (`from sqlalchemy.dialects.postgresql import TSVECTOR, ARRAY`), 181 (`search_vector = ... TSVECTOR`), 224/231 (`types = ... ARRAY(String)`)
- **Severity:** Critical
- **Description:** `VideoCache.search_vector` is declared as `TSVECTOR` and `AggregatedVideo.types` as `ARRAY(String)`. When `db.py::init_db()` calls `Base.metadata.create_all()` with a SQLite URL, SQLAlchemy raises `CompileError` because the SQLite type compiler cannot render `TSVECTOR` or `ARRAY`.
- **Impact:** The project architecture specifies SQLite as the default/aiosqlite path, but it cannot even start on SQLite. Only the PostgreSQL path works.
- **Evidence:**
  ```
  CompileError (in table 't', column 'search_vector'):
  Compiler <sqliteTypeCompiler> can't render element of type TSVECTOR
  ```
  (verified by running `Base.metadata.create_all(create_engine('sqlite://'))` with those column types.)

### 2. PostgreSQL LISTEN/NOTIFY has no SQLite fallback, breaking SSE/events on SQLite
- **File:** `backend/app/services/notify_sender.py`, `backend/app/services/listen_manager.py`
- **Lines:** `notify_sender.py:33` (`import asyncpg`), `listen_manager.py:52` (`import asyncpg`), `notify_sender.py:36-37`, `listen_manager.py:58`
- **Severity:** Critical
- **Description:** The event bus is hard-wired to `asyncpg`. `NotifySender.send()` imports and connects via `asyncpg` directly; `ListenConnectionManager` starts a background loop that calls `asyncpg.connect(...)`. On SQLite these calls fail and are caught, but no SQLite-compatible fallback (in-process asyncio Queue, aiosqlite hooks, etc.) is provided.
- **Impact:** On SQLite, download progress / health / site-delete events are never pushed, so the SSE endpoint (`/api/sse`) is effectively dead. The LISTEN reconnect loop also spins and logs errors indefinitely.
- **Evidence:**
  ```python
  # notify_sender.py:36-37
  async with self._lock:
      if self._conn is None or self._conn.is_closed():
          self._conn = await asyncpg.connect(dsn=self._dsn_for_asyncpg())
  ```

---

## High

### 3. Default database URL contradicts the architecture spec (SQLite default)
- **File:** `backend/app/config.py`
- **Line:** 11 (`database_url: str = "postgresql+asyncpg://localhost:5432/home_theater"`)
- **Severity:** High
- **Description:** `CLAUDE.md` states the stack is “SQLite (aiosqlite) default / PostgreSQL (asyncpg) optional”, but the Pydantic `Settings` default is PostgreSQL. The bundled `.env.example` also declares PostgreSQL as default.
- **Impact:** A fresh clone without an explicit `.env` starts on PostgreSQL, surprising users/lan deployers expecting the documented SQLite default. Combined with bug #1, users who do try SQLite will hit a hard startup crash.
- **Evidence:** `config.py:11` and `backend/.env.example:3`.

---

## Low

### 13. Direct download worker holds a DB session open during long network streams
- **File:** `backend/app/services/downloader.py`
- **Lines:** 372-468 (`_run_direct_download`)
- **Severity:** Low
- **Description:** An `async_session_factory()` session is opened before the HTTP stream and kept open for the entire download. While the session is only used for progress commits, it still occupies a connection/transaction for a potentially long-running operation.
- **Impact:** Under high concurrency or with PostgreSQL, this can exhaust pool connections or hold locks longer than necessary.
- **Evidence:** `async with async_session_factory() as session:` encloses `async with client.stream(...) as resp` and the streaming loop.

### 14. System-category parent-cycle check is only one level deep
- **File:** `backend/app/api/system_categories.py`
- **Lines:** 89-95
- **Severity:** Low
- **Description:** `update_system_category` only rejects `parent_id == cat_id`. It does not detect multi-level cycles (e.g. A.parent = B while B.parent = A).
- **Impact:** A malicious or buggy request can create an infinite recursion in `list_system_categories`.
- **Evidence:** Only checks `if data["parent_id"] == cat_id`.

### 15. `toggle_favorite` has a race-condition that can raise unhandled `IntegrityError`
- **File:** `backend/app/api/favorites.py`
- **Lines:** 42-59
- **Severity:** Low
- **Description:** `toggle_favorite` checks for an existing favorite and inserts a new one without a transaction/try-except around the insert. A concurrent request can create the row between the check and insert, raising `IntegrityError`.
- **Impact:** Concurrent toggles can return HTTP 500 instead of a predictable result.
- **Evidence:** Insert at line 54-57 has no `try: ... except IntegrityError:`.

---

## Summary

| Severity | Count | Key issues |
|----------|-------|------------|
| Critical | 2 | SQLite startup broken (PG-only types); event bus broken on SQLite (asyncpg-only) |
| High | 1 | Default DB mismatch |
| Medium | 0 | — |
| Low | 3 | Long-lived download session; shallow cycle check; favorite race |
| **Total** | **6** | |

The most urgent fixes are the SQLite compatibility blockers (#1, #2) because they can prevent the application from starting on the documented default backend.
