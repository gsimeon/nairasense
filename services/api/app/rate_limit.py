"""In-memory sliding-window rate limiter for local/single-instance use.

For multi-instance production deployments, replace with a shared Redis-backed limiter
and configure trusted proxy headers.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_MAX_TRACKED_KEYS = 5000
_REQUEST_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def make_rate_limiter(max_requests: int, window_seconds: int):
    def _limiter(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        key = f"{request.url.path}:{client_ip}"
        now = time.monotonic()

        if len(_REQUEST_BUCKETS) > _MAX_TRACKED_KEYS:
            stale_keys = [
                k for k, q in _REQUEST_BUCKETS.items() if not q or (now - q[-1]) > window_seconds
            ]
            for k in stale_keys:
                _REQUEST_BUCKETS.pop(k, None)

        bucket = _REQUEST_BUCKETS[key]
        while bucket and (now - bucket[0]) > window_seconds:
            bucket.popleft()
        if len(bucket) >= max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please wait a moment and try again.",
            )
        bucket.append(now)

    return _limiter


rate_limit_infer = make_rate_limiter(max_requests=60, window_seconds=60)
rate_limit_auth = make_rate_limiter(max_requests=30, window_seconds=60)
