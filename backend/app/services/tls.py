"""全局共享的 TLS 上下文。

Windows 上 ``ssl.create_default_context()`` 会加载系统证书存储，某些机器上要
8–45 秒才返回。httpx 每次新建 AsyncClient 都会调用它，于是每个请求都可能把
事件循环卡住几十秒（表现为「请求超时」+ 整站卡顿）。

这里只在进程内创建一次，所有 httpx 客户端通过 ``verify=get_ssl_context()`` 复用。
"""

from __future__ import annotations

import logging
import ssl
import threading

logger = logging.getLogger(__name__)

_ctx: ssl.SSLContext | None = None
_lock = threading.Lock()


def get_ssl_context() -> ssl.SSLContext:
    """返回进程级共享 SSLContext（首次调用会阻塞，之后直接复用）。"""
    global _ctx
    if _ctx is None:
        with _lock:
            if _ctx is None:
                _ctx = ssl.create_default_context()
    return _ctx


def warm_ssl_context() -> None:
    """在后台线程预热，避免第一个请求承担建上下文的开销。"""
    def _warm() -> None:
        try:
            get_ssl_context()
            logger.info("TLS 上下文预热完成")
        except Exception as exc:  # pragma: no cover
            logger.warning("TLS 上下文预热失败: %s", exc)

    threading.Thread(target=_warm, name="tls-warmup", daemon=True).start()
