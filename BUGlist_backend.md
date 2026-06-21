# Backend Bug List — Home Theater v2

> Scope: `backend/app/main.py`, `models.py`, `schemas.py`, `db.py`, `config.py`, `constants.py`, `api/*.py`, `services/*.py`.
> This is a read-only review; no files were modified.

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

### 4. `original_id` becomes empty string when resource site returns `vod_id=0`
- **File:** `backend/app/services/source_client.py`
- **Lines:** 175 (`_normalize_list_item`), 194 (`_normalize_detail_item`)
- **Severity:** High
- **Description:** Both normalizers build `original_id` with `str(raw.get("vod_id") or raw.get("id") or "")`. Because `0` is falsy in Python, a legitimate ID of `0` is converted to `""`. The same problem affects `id=0`.
- **Impact:**
  - Rows for ID `0` get an empty `original_id`.
  - The unique index `(site_id, original_id)` collapses every ID-0 video into one row, causing data loss/silent overwrites.
  - `videolist(ids=[...])` lookups for ID `0` will not match.
- **Evidence:**
  ```python
  "original_id": str(raw.get("vod_id") or raw.get("id") or ""),
  ```

### 5. `SourceClient` cannot build the `h` (hours) parameter required by the hard spec
- **File:** `backend/app/services/source_client.py`
- **Lines:** 60-80 (`_build_params`), 140-154 (`list`), 156-169 (`videolist`)
- **Severity:** High
- **Description:** The hard spec lists `h=<小时数>` as a valid parameter for both `ac=list` and `ac=videolist`. `_build_params` supports `ac`, `t`, `pg`, `wd`, `by`, `ids` but has no `h` argument, and neither `list()` nor `videolist()` expose it.
- **Impact:** Any future feature that needs “recent N hours” queries must bypass the designated client and hand-roll URLs, increasing the risk of spec drift and duplicated logic.
- **Evidence:** `_build_params` body; `h` is absent from all signatures.

---

## Medium

### 6. 24-hour site availability is actually “since midnight UTC”, not last 24 hours
- **File:** `backend/app/api/sites.py`
- **Line:** 158
- **Severity:** Medium
- **Description:** `get_site_health` computes `since_24h` as `_utcnow().replace(hour=0, minute=0, second=0, microsecond=0)`, i.e. the start of the current UTC day, not `_utcnow() - timedelta(hours=24)`.
- **Impact:** The availability percentage ignores probes from the previous 23:59 to 00:00 UTC window and gives a misleading number for users in non-UTC timezones.
- **Evidence:**
  ```python
  since_24h = _utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
  ```

### 7. Pending aggregated-cache titles are cleared before refresh succeeds
- **File:** `backend/app/services/crawler.py`
- **Lines:** 1201-1204
- **Severity:** Medium
- **Description:** In `_refresh_aggregated_cache`, `self._pending_norm_titles` is swapped to a local variable and cleared before `refresh_aggregated_view()` runs. If the refresh raises or returns `False`, the pending set is already gone.
- **Impact:** A transient DB error during incremental refresh causes the affected aggregation keys to be silently dropped; the cache will stay stale until the next full rebuild.
- **Evidence:**
  ```python
  to_refresh = self._pending_norm_titles
  self._pending_norm_titles = set()
  if not to_refresh:
      return
  ok = await refresh_aggregated_view(db, affected_norm_titles=to_refresh)
  ```

### 8. `parse_episodes` violates the strict “exactly 3 segments” contract
- **File:** `backend/app/services/parser.py`
- **Lines:** 34-40
- **Severity:** Medium
- **Description:** The parser raises only when `len(parts) < 3` and joins extras into the suffix. The hard spec says each line must be split into **exactly** three fields (`episode$URL$suffix`). URLs that legitimately contain a `$` character (e.g. query strings or paths) will be mis-split.
- **Impact:** Non-compliant input can silently corrupt the URL or suffix. Conversely, malformed lines with extra `$` are accepted instead of rejected.
- **Evidence:**
  ```python
  if len(parts) < 3:
      raise ValueError(...)
  ep_name, url, suffix = parts[0], parts[1], "$".join(parts[2:])
  ```

### 9. Category-filter subquery triggers SQLAlchemy warning and may be fragile
- **File:** `backend/app/api/videos.py`
- **Lines:** 540-546
- **Severity:** Medium
- **Description:** `cat_subq` is built with `.subquery()` and passed directly to `AggregatedVideoV3.id.in_(cat_subq)`. SQLAlchemy emits `SAWarning: Coercing Subquery object into a select() for use in IN(); please pass a select() construct explicitly`.
- **Impact:** Works today but is deprecated/unsupported territory; future SQLAlchemy versions may break. It also litters test output.
- **Evidence:** pytest warnings:
  ```
  SAWarning: Coercing Subquery object into a select() for use in IN();
  please pass a select() construct explicitly
  ```

### 10. `cleanup_expired` bypasses `SourceClient` and assumes JSON responses
- **File:** `backend/app/api/videos.py`
- **Lines:** 1341-1358
- **Severity:** Medium
- **Description:** The cleanup endpoint builds `?ac=videolist&ids=...` URLs by hand and calls `resp.json()` without content-type handling or retries. It also skips the centralized `SourceClient`, so it does not benefit from its retry logic or URL-encoding.
- **Impact:** If a site returns XML (common in older AppleCMS deployments) or a transient non-JSON error, the cleanup aborts for that site instead of handling it gracefully.
- **Evidence:**
  ```python
  url = f"{site.base_url.rstrip('/')}?ac=videolist&ids={ids_str}"
  resp = await client.get(url)
  data = resp.json()
  ```

### 11. `NotifySender` interpolates channel name into SQL
- **File:** `backend/app/services/notify_sender.py`
- **Lines:** 39-40
- **Severity:** Medium
- **Description:** The `NOTIFY` statement is built with an f-string: `f"NOTIFY {channel}, {self._dollar_quote(payload)}"`. Although `channel` is validated against an allow-list, this is still unsafe SQL construction and would break if a future change adds dynamic channels.
- **Impact:** SQL-injection pattern in the event bus; currently mitigated only by the hardcoded allow-list.
- **Evidence:**
  ```python
  await self._conn.execute(f"NOTIFY {channel}, {self._dollar_quote(payload)}")
  ```
  (Same pattern exists in `listen_manager.py:68` for `LISTEN {ch}`.)

---

## Low

### 12. Request URL in source-client logs is not URL-encoded
- **File:** `backend/app/services/source_client.py`
- **Line:** 83
- **Severity:** Low
- **Description:** `url_with_params` is built with raw f-string interpolation, so Chinese search keywords or special characters are not percent-encoded in the logged URL. The actual HTTP request uses httpx `params=` and is correct.
- **Impact:** Misleading logs; URLs copied from logs may be invalid.
- **Evidence:**
  ```python
  url_with_params = f"{self.base_url}?{ '&'.join(f'{k}={v}' for k, v in params.items()) }"
  ```

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

### 16. `cleanup_expired` does not URL-encode original IDs
- **File:** `backend/app/api/videos.py`
- **Line:** 1347
- **Severity:** Low
- **Description:** `ids_str = ",".join(str(x) for x in batch)` is concatenated into the URL without quoting. An `original_id` containing `&`, `#`, `?`, etc. would break the request.
- **Impact:** Cleanup may fail or behave incorrectly for sites with non-alphanumeric IDs.

### 17. Duplicate `await db.commit()` in aggregated-cache refresh
- **File:** `backend/app/services/crawler.py`
- **Line:** 1222
- **Severity:** Low
- **Description:** After refreshing the aggregated cache, the code calls `await db.commit()` twice in a row.
- **Impact:** Harmless but indicates a copy-paste error and may confuse future maintainers.
- **Evidence:**
  ```python
  await db.commit()
  await db.commit()
  ```

---

## Summary

| Severity | Count | Key issues |
|----------|-------|------------|
| Critical | 2 | SQLite startup broken (PG-only types); event bus broken on SQLite (asyncpg-only) |
| High | 3 | Default DB mismatch; `original_id=0` → empty string; `SourceClient` missing `h` param |
| Medium | 6 | 24h availability window wrong; pending titles lost on refresh failure; parser spec violation; subquery warning; cleanup bypasses client; SQL injection pattern in NOTIFY |
| Low | 6 | Log URL encoding; long-lived download session; shallow cycle check; favorite race; unencoded IDs; duplicate commit |

The most urgent fixes are the SQLite compatibility blockers (#1, #2) and the `original_id` falsy-handling bug (#4), because they can corrupt data or prevent the application from starting on the documented default backend.
