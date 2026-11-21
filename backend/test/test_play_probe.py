import httpx

from app.api.play import _probe_url


class FakeClient:
    def __init__(self, head_status: int, get_status: int | None = None):
        self.head_status = head_status
        self.get_status = get_status
        self.get_calls = 0

    async def head(self, url: str, **kwargs):
        return httpx.Response(
            self.head_status, request=httpx.Request("HEAD", url)
        )

    async def get(self, url: str, **kwargs):
        self.get_calls += 1
        assert kwargs["headers"] == {"Range": "bytes=0-0"}
        return httpx.Response(
            self.get_status or 500, request=httpx.Request("GET", url)
        )


async def test_probe_rejects_missing_resource_without_get_retry():
    client = FakeClient(404)
    assert await _probe_url(client, "https://probe.test/404") is False
    assert client.get_calls == 0


async def test_probe_accepts_successful_head():
    client = FakeClient(200)
    assert await _probe_url(client, "https://probe.test/200") is True
    assert client.get_calls == 0


async def test_probe_rechecks_head_restriction_with_range_get():
    client = FakeClient(405, 206)
    assert await _probe_url(client, "https://probe.test/405") is True
    assert client.get_calls == 1


async def test_probe_rejects_failed_range_get():
    client = FakeClient(403, 403)
    assert await _probe_url(client, "https://probe.test/403") is False
    assert client.get_calls == 1
