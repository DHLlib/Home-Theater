import httpx
import pytest
from fastapi import FastAPI

from app.api.play import router as play_router
from app.api.settings_api import router as settings_router
from app.db import get_db
from app.services import feature_settings, playback_guard


@pytest.fixture(autouse=True)
def _reset_feature_cache():
    feature_settings._cache = dict(feature_settings.DEFAULTS)
    feature_settings._cache_expires_at = 0.0
    yield
    feature_settings._cache = dict(feature_settings.DEFAULTS)
    feature_settings._cache_expires_at = 0.0


async def test_playback_feature_defaults(db_session):
    values = await feature_settings.get_playback_features()
    assert values == {
        "media_analysis": True,
        "playback_guard": True,
        "enhancement": False,
    }


async def test_playback_feature_switch_controls_heartbeat(db_session):
    app = FastAPI()
    app.include_router(settings_router, prefix="/api")
    app.include_router(play_router, prefix="/api")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        disabled = await client.put(
            "/api/settings/playback-features", json={"playback_guard": False}
        )
        assert disabled.status_code == 200
        assert disabled.json()["playback_guard"] is False
        await client.post(
            "/api/play/heartbeat", json={"session_id": "disabled-guard", "active": True}
        )
        assert not playback_guard.is_playback_active()

        enabled = await client.put(
            "/api/settings/playback-features", json={"playback_guard": True}
        )
        assert enabled.json()["playback_guard"] is True
        await client.post(
            "/api/play/heartbeat", json={"session_id": "enabled-guard", "active": True}
        )
        assert playback_guard.is_playback_active()
        disabled_again = await client.put(
            "/api/settings/playback-features", json={"playback_guard": False}
        )
        assert disabled_again.status_code == 200
        assert not playback_guard.is_playback_active()


async def test_enhancement_switch_requires_ffmpeg(db_session, monkeypatch):
    monkeypatch.setattr(feature_settings, "enhancement_available", lambda: False)
    with pytest.raises(ValueError, match="未安装 ffmpeg"):
        await feature_settings.set_playback_features({"enhancement": True}, db_session)
    assert not await feature_settings.is_feature_enabled("enhancement")
