import re
import httpx

FEIFAN_URL_RE = re.compile(r'const url\s*=\s*"([^"]+)"')


async def resolve_feifan(share_url: str) -> str | None:
    """
    访问 feifan 分享页，提取真实的 m3u8 路径并拼接完整 URL。
    例如：
      share_url = "https://vip.ffzy-plays.com/share/xxx"
      返回 "https://vip.ffzy-plays.com/2026xxx/index.m3u8?sign=xxx"
    """
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": share_url,
            }
            resp = await client.get(share_url, headers=headers)
            resp.raise_for_status()
            html = resp.text
            match = FEIFAN_URL_RE.search(html)
            if not match:
                return None
            real_path = match.group(1)
            if real_path.startswith("http"):
                return real_path
            # 拼接域名
            base = share_url.split("/share/")[0]
            return base + real_path
    except Exception:
        return None
