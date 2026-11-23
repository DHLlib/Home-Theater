"""站点 API 地址归一化，用于判重。

同一个资源站经常以 `http`/`https`、带不带末尾斜杠、主机大小写不同的形式
出现（例如 `http://api.ffzyapi.com/api.php/provide/vod/` 与
`https://api.ffzyapi.com/api.php/provide/vod`），按原字符串比较会漏判，
导致重复添加。
"""
from __future__ import annotations

from urllib.parse import urlsplit

_DEFAULT_PORTS = {"http": 80, "https": 443}


def site_url_key(url: str) -> str:
    """把站点 API 地址归一化成可比较的 key（忽略 scheme/默认端口/末尾斜杠）。"""
    raw = (url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"http://{raw}"
    try:
        parts = urlsplit(raw)
    except ValueError:
        return raw.rstrip("/").lower()

    host = (parts.hostname or "").lower()
    try:
        port = parts.port
    except ValueError:
        port = None
    if port is not None and port != _DEFAULT_PORTS.get(parts.scheme.lower()):
        host = f"{host}:{port}"

    key = f"{host}{parts.path.rstrip('/')}"
    if parts.query:
        key += f"?{parts.query}"
    return key
