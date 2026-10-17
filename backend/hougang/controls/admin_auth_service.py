"""<<control>> AdminAuthService: verify credentials, manage sessions, authorise protected admin operations.

Implements UC-4.11 Authorize Admin, which UC-4.8 View Model Diagnostics and UC-4.9 Manage Database
include. The password is never stored in plaintext (SRS 5.3.1): AppBootstrap hashes the value from
the environment and passes only the hash. Sessions live in memory and expire after a period of
inactivity; an expired session sends the admin back to the login page (S7).
"""

from __future__ import annotations

import hmac
import secrets
import threading
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from hougang.errors import AuthError, ValidationError

# Checked when no admin password is configured, so a failed login takes the same time either way.
_DUMMY_HASH = generate_password_hash(secrets.token_hex(16))


class AdminAuthService:
    """<<control>> Admin authorization (UC-4.11). `password_hash` and `sessions` (session id -> last
    activity time) are the diagram's private attributes."""

    def __init__(
        self,
        password_hash: str | None,
        username: str = "admin",
        idle_minutes: int = 30,
        clock: Callable[[], datetime] | None = None,
    ):
        self._password_hash = password_hash
        self._username = username
        self._sessions: dict[str, datetime] = {}
        self._idle = timedelta(minutes=idle_minutes)
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()

    def login(self, username: str, password: str) -> str:
        """Verify the credentials and start a session; return its id (UC-4.11 steps 4-7).

        Raises ValidationError if a field is empty (EX2) and AuthError with a generic message that
        does not say which field was wrong (EX1, SRS 4.11.3.3).
        """
        missing = {}
        if not (username or "").strip():
            missing["username"] = "Enter your username."
        if not password:
            missing["password"] = "Enter your password."
        if missing:
            raise ValidationError("Please enter both your username and password.", fields=missing)
        password_ok = check_password_hash(self._password_hash or _DUMMY_HASH, password)
        username_ok = hmac.compare_digest(username.strip().encode(), self._username.encode())
        if not (self._password_hash and password_ok and username_ok):
            raise AuthError("Invalid username or password.")
        session_id = secrets.token_urlsafe(32)
        now = self._clock()
        with self._lock:
            self._sessions = {sid: seen for sid, seen in self._sessions.items() if now - seen <= self._idle}
            self._sessions[session_id] = now
        return session_id

    def require_admin(self, session_id: str) -> None:
        """Allow the request only with a live admin session (UC-4.11 step 2, SRS 4.11.3.1 / 4.11.3.4).

        Each successful check extends the session. Raises AuthError otherwise.
        """
        now = self._clock()
        with self._lock:
            last_seen = self._sessions.get(session_id or "")
            if last_seen is None:
                raise AuthError("Please log in as an administrator to continue.", details={"reason": "no_session"})
            if now - last_seen > self._idle:
                del self._sessions[session_id]
                raise AuthError("Your admin session has expired. Please log in again.", details={"reason": "expired"})
            self._sessions[session_id] = now

    def logout(self, session_id: str) -> None:
        """End the session (UC-4.11 AC.1). Logging out twice is harmless."""
        with self._lock:
            self._sessions.pop(session_id or "", None)
