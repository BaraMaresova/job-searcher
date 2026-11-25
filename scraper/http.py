"""HTTP klient se slušným chováním: běžný User-Agent a pauzy mezi požadavky."""
from __future__ import annotations

import time

import httpx

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
DELAY_SECONDS = 0.5


class PoliteClient:
    def __init__(self, delay: float = DELAY_SECONDS):
        self.delay = delay
        self._last = 0.0
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "cs-CZ,cs;q=0.9"},
            follow_redirects=True,
            timeout=30,
        )

    def _wait(self):
        elapsed = time.monotonic() - self._last
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last = time.monotonic()

    def get(self, url: str, **kwargs) -> httpx.Response:
        self._wait()
        r = self.client.get(url, **kwargs)
        r.raise_for_status()
        return r

    def post(self, url: str, **kwargs) -> httpx.Response:
        self._wait()
        r = self.client.post(url, **kwargs)
        r.raise_for_status()
        return r

    def close(self):
        self.client.close()
