"""WAF 人机校验（Cloudflare 挑战页）识别测试。

真实事故：无尽ME 的 videolist 偶尔返回 Cloudflare「Just a moment...」403，
旧逻辑把任何 403 都当成站点封禁，一次请求就把 12,851 条补全判死。
这里锁定「挑战页 ≠ 接口封禁」的识别边界。
"""
import httpx
import pytest

from app.services.source_client import (
    SourceChallengeError,
    SourceClient,
    SourceHttpError,
    SourceProtocolError,
    _is_challenge_response,
)


def _response(
    status: int,
    *,
    body: str,
    content_type: str = "text/html; charset=UTF-8",
    headers: dict | None = None,
) -> httpx.Response:
    merged = {"content-type": content_type}
    merged.update(headers or {})
    return httpx.Response(
        status_code=status,
        headers=merged,
        content=body.encode("utf-8"),
        request=httpx.Request("GET", "http://site.test/api.php/provide/vod"),
    )


def test_cloudflare_challenge_page_detected():
    resp = _response(
        403,
        body='<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>',
    )
    assert _is_challenge_response(resp) is True


def test_cf_mitigated_header_detected_even_without_html():
    resp = _response(
        403,
        body="blocked",
        content_type="text/plain",
        headers={"cf-mitigated": "challenge"},
    )
    assert _is_challenge_response(resp) is True


def test_json_403_is_not_challenge():
    """接口本身的 403 仍是真封禁，不能被当成可重试的挑战。"""
    resp = _response(
        403,
        body='{"code":0,"msg":"forbidden"}',
        content_type="application/json",
    )
    assert _is_challenge_response(resp) is False


def test_html_without_challenge_marker_is_not_challenge():
    resp = _response(403, body="<html><body>Forbidden</body></html>")
    assert _is_challenge_response(resp) is False


def test_cloudflare_hard_block_page_is_not_retried():
    """「Attention Required」是 WAF 硬拦截，不是可自愈的挑战，不能白等重试。"""
    resp = _response(
        403,
        body="<html><head><title>Attention Required! | Cloudflare</title></head></html>",
    )
    assert _is_challenge_response(resp) is False


class _StubHttpClient:
    def __init__(self, response: httpx.Response):
        self._response = response

    async def get(self, url, params=None):
        return self._response


class _RecordingHttpClient:
    def __init__(self, response: httpx.Response):
        self._response = response
        self.urls: list[str] = []

    async def get(self, url, params=None):
        self.urls.append(str(url))
        return self._response


def _client_with_recorder(response: httpx.Response) -> tuple[SourceClient, _RecordingHttpClient]:
    recorder = _RecordingHttpClient(response)
    client = SourceClient(site_id=1, base_url="http://site.test/api", name="站点")

    async def _stub_get_client():
        return recorder

    client._get_client = _stub_get_client  # type: ignore[method-assign]
    return client, recorder


async def test_videolist_keeps_ids_commas_literal():
    """ids 必须是字面逗号：%2C 会被 Cloudflare 判为可疑请求直接挑战。"""
    client, recorder = _client_with_recorder(
        _response(200, body='{"list": []}', content_type="application/json")
    )
    await client.videolist(ids=["100111", "100153", "100228"])

    assert len(recorder.urls) == 1
    assert "ids=100111,100153,100228" in recorder.urls[0]
    assert "%2C" not in recorder.urls[0]


async def test_search_keyword_is_still_url_encoded():
    """只放行逗号，wd 这类中文参数必须继续百分号编码。"""
    client, recorder = _client_with_recorder(
        _response(200, body='{"list": []}', content_type="application/json")
    )
    await client.list(wd="白蛇", pg=1)

    assert "wd=%E7%99%BD%E8%9B%87" in recorder.urls[0]


class _FailingHttpClient:
    def __init__(self, exc: Exception):
        self.exc = exc

    async def get(self, url, params=None):
        raise self.exc


async def _raise_network(exc: Exception):
    client = SourceClient(
        site_id=1, base_url="http://site.test/api", name="暴风资源", max_attempts=1
    )

    async def _stub_get_client():
        return _FailingHttpClient(exc)

    client._get_client = _stub_get_client  # type: ignore[method-assign]
    await client._get({"ac": "list"})


async def test_network_timeout_reports_readable_reason():
    """httpx 的超时异常 str 为空，站点面板不能只显示「失败：」。"""
    with pytest.raises(SourceProtocolError) as exc_info:
        await _raise_network(httpx.ConnectTimeout(""))
    message = str(exc_info.value)
    assert "连接超时" in message
    assert not message.rstrip().endswith("：")


async def test_connection_reset_reports_readable_reason():
    with pytest.raises(SourceProtocolError) as exc_info:
        await _raise_network(httpx.ReadError(""))
    assert "连接被重置" in str(exc_info.value)


async def _raise_for(response: httpx.Response):
    client = SourceClient(site_id=1, base_url="http://site.test/api", name="站点")

    async def _stub_get_client():
        return _StubHttpClient(response)

    client._get_client = _stub_get_client  # type: ignore[method-assign]
    await client._get({"ac": "videolist"})


async def test_get_raises_challenge_error_for_waf_page():
    resp = _response(403, body="<html><title>Just a moment...</title></html>")
    with pytest.raises(SourceChallengeError) as exc_info:
        await _raise_for(resp)
    # 仍是 SourceHttpError 子类，旧的熔断/兜底分支不需要改
    assert isinstance(exc_info.value, SourceHttpError)
    assert exc_info.value.status_code == 403
    assert "人机校验" in str(exc_info.value)


async def test_get_raises_plain_http_error_for_real_forbidden():
    resp = _response(
        403, body='{"code":0}', content_type="application/json"
    )
    with pytest.raises(SourceHttpError) as exc_info:
        await _raise_for(resp)
    assert not isinstance(exc_info.value, SourceChallengeError)
    assert exc_info.value.status_code == 403
