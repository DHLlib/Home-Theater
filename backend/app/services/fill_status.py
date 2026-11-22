"""批量补全 videolist 的轻量状态跟踪。

进程内单例持有权威状态，站点级迁移与任务结束时落 AppConfig
（key=fill_videolist_status），前端轮询 GET 接口读内存快照。
重启后若持久化状态仍停在 running，说明任务随进程死亡，
启动时由 recover_interrupted 恢复为 interrupted。
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as insert_cls

from app.models import AppConfig, _utcnow

logger = logging.getLogger(__name__)

# 站点终态：计入 completed_sites
TERMINAL_SITE_STATES = ("done", "partial", "blocked", "failed")


def _idle_status() -> dict:
    return {
        "state": "idle",
        "current_site_id": None,
        "current_site_name": None,
        "completed_sites": 0,
        "total_sites": 0,
        "missing": 0,
        "filled": 0,
        "failed": 0,
        "skipped": 0,
        "started_at": None,
        "finished_at": None,
        "error": None,
        "sites": [],
    }


def _new_site(site_id: int, site_name: str) -> dict:
    return {
        "site_id": site_id,
        "site_name": site_name,
        "state": "pending",
        "missing": 0,
        "filled": 0,
        "failed": 0,
        "skipped": 0,
        "error": None,
    }


class FillStatusTracker:
    """补全任务状态机（整体与站点两级）。

    整体：idle → running → done / partial / failed（重启恢复为 interrupted）
    站点：pending → running → done / partial / blocked / failed
    """

    KEY = "fill_videolist_status"

    def __init__(self) -> None:
        self._status: dict = _idle_status()
        self._loaded = False

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def snapshot(self) -> dict:
        """返回当前状态的深拷贝（顶层 + 站点列表），可直接喂给 FillStatus schema。"""
        snap = dict(self._status)
        snap["sites"] = [dict(site) for site in self._status["sites"]]
        return snap

    def is_running(self) -> bool:
        return self._status["state"] == "running"

    # ------------------------------------------------------------------
    # 生命周期（全部是同步内存操作，事件循环内原子）
    # ------------------------------------------------------------------

    def begin(self) -> None:
        """启动一次新任务：重置为 running。必须在创建后台协程前同步调用。"""
        status = _idle_status()
        status["state"] = "running"
        status["started_at"] = _utcnow().isoformat()
        self._status = status
        self._loaded = True

    def set_sites(self, sites: list[tuple[int, str]]) -> None:
        """登记本次任务要处理的站点清单（全部置为 pending）。"""
        self._status["sites"] = [_new_site(sid, name) for sid, name in sites]
        self._recount()

    def site_started(self, site_id: int, missing: int) -> None:
        site = self._site(site_id)
        if site is None:
            return
        site["state"] = "running"
        site["missing"] = missing
        self._status["current_site_id"] = site_id
        self._status["current_site_name"] = site["site_name"]
        self._recount()

    def site_progress(self, site_id: int, *, filled: int, failed: int) -> None:
        """批次级进度（仅内存，不落库，避免每批一次写）。"""
        site = self._site(site_id)
        if site is None:
            return
        site["filled"] = filled
        site["failed"] = failed
        self._recount()

    def site_finished(
        self,
        site_id: int,
        state: str,
        *,
        filled: int,
        failed: int,
        skipped: int,
        error: str | None = None,
    ) -> None:
        site = self._site(site_id)
        if site is None:
            return
        site["state"] = state
        site["filled"] = filled
        site["failed"] = failed
        site["skipped"] = skipped
        site["error"] = error
        if self._status["current_site_id"] == site_id:
            self._status["current_site_id"] = None
            self._status["current_site_name"] = None
        self._recount()

    def finish(self, state: str, error: str | None = None) -> None:
        self._status["state"] = state
        self._status["error"] = error
        self._status["finished_at"] = _utcnow().isoformat()
        self._status["current_site_id"] = None
        self._status["current_site_name"] = None

    def reset(self) -> None:
        """重置为 idle（测试与兜底用）。"""
        self._status = _idle_status()
        self._loaded = True

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------

    async def persist(self, db_factory) -> None:
        """把当前快照写入 AppConfig（整体 upsert，最后一次写获胜）。"""
        payload = json.dumps(self._status, ensure_ascii=False)
        try:
            async with db_factory() as db:
                stmt = insert_cls(AppConfig).values(
                    key=self.KEY, value=payload, updated_at=_utcnow()
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["key"],
                    set_={"value": payload, "updated_at": _utcnow()},
                )
                await db.execute(stmt)
                await db.commit()
        except Exception as exc:
            logger.warning("持久化补全任务状态失败: %s", exc)

    async def ensure_loaded(self, db_factory) -> None:
        """首次读取前从持久化恢复（不做 running → interrupted 改写）。"""
        if self._loaded:
            return
        self._loaded = True
        stored = await self._read_stored(db_factory)
        if stored is not None:
            self._status = stored

    async def recover_interrupted(self, db_factory) -> None:
        """启动时调用：持久化里仍是 running 的任务说明进程死过，标记为 interrupted。"""
        self._loaded = True
        stored = await self._read_stored(db_factory)
        if stored is None:
            return
        self._status = stored
        if self._status.get("state") != "running":
            return
        for site in self._status["sites"]:
            if site["state"] == "running":
                site["state"] = "failed"
                site["error"] = "服务重启，任务中断"
        self._recount()
        self._status["state"] = "interrupted"
        self._status["error"] = "服务重启，任务中断"
        self._status["finished_at"] = _utcnow().isoformat()
        self._status["current_site_id"] = None
        self._status["current_site_name"] = None
        await self.persist(db_factory)
        logger.info("检测到重启前未完成的补全任务，标记为 interrupted")

    async def _read_stored(self, db_factory) -> dict | None:
        try:
            async with db_factory() as db:
                result = await db.execute(
                    select(AppConfig).where(AppConfig.key == self.KEY)
                )
                row = result.scalar_one_or_none()
        except Exception as exc:
            logger.warning("读取补全任务状态失败: %s", exc)
            return None
        if row is None:
            return None
        try:
            data = json.loads(row.value)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict) or "state" not in data:
            return None
        status = _idle_status()
        status.update(data)
        status["sites"] = [
            {**_new_site(0, ""), **site}
            for site in (data.get("sites") or [])
            if isinstance(site, dict)
        ]
        return status

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _site(self, site_id: int) -> dict | None:
        for site in self._status["sites"]:
            if site["site_id"] == site_id:
                return site
        return None

    def _recount(self) -> None:
        sites = self._status["sites"]
        self._status["total_sites"] = len(sites)
        self._status["completed_sites"] = sum(
            1 for site in sites if site["state"] in TERMINAL_SITE_STATES
        )
        for key in ("missing", "filled", "failed", "skipped"):
            self._status[key] = sum(site[key] for site in sites)


fill_status_tracker = FillStatusTracker()
