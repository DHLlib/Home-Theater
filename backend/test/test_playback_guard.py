import asyncio

from app.services import playback_guard


async def test_playback_guard_releases_on_stop():
    playback_guard.heartbeat("session-stop")
    waiter = asyncio.create_task(playback_guard.wait_until_idle())
    await asyncio.sleep(0)
    assert not waiter.done()
    playback_guard.stop("session-stop")
    await asyncio.wait_for(waiter, timeout=1)


async def test_playback_guard_expires_and_honors_stop_event():
    playback_guard.heartbeat("session-expiry")
    playback_guard._sessions["session-expiry"] = 0
    await playback_guard.wait_until_idle()

    playback_guard.heartbeat("session-cancel")
    stop_event = asyncio.Event()
    stop_event.set()
    await playback_guard.wait_until_idle(stop_event)
    playback_guard.stop("session-cancel")
