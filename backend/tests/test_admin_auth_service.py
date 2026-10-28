"""AdminAuthService (UC-4.11 Authorize Admin)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from werkzeug.security import generate_password_hash

from hougang.controls.admin_auth_service import AdminAuthService
from hougang.errors import AuthError, ValidationError


class Clock:
    def __init__(self):
        self.now = datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def advance(self, minutes):
        self.now += timedelta(minutes=minutes)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def auth(clock):
    return AdminAuthService(generate_password_hash("s3cret-pass"), username="admin", idle_minutes=30, clock=clock)


def test_uc411_login_creates_a_session(auth):
    session_id = auth.login("admin", "s3cret-pass")
    assert len(session_id) >= 32
    auth.require_admin(session_id)


@pytest.mark.parametrize("username, password", [("admin", "wrong"), ("root", "s3cret-pass"), ("root", "wrong")])
def test_uc411_ex1_invalid_credentials_get_one_generic_message(auth, username, password):
    with pytest.raises(AuthError) as caught:
        auth.login(username, password)
    assert caught.value.message == "Invalid username or password."  # SRS 4.11.3.3


def test_uc411_ex2_empty_fields(auth):
    with pytest.raises(ValidationError) as caught:
        auth.login("", "")
    assert set(caught.value.fields) == {"username", "password"}


def test_uc411_without_a_configured_password_nobody_can_log_in():
    with pytest.raises(AuthError):
        AdminAuthService(None).login("admin", "anything")


def test_uc411_require_admin_rejects_missing_or_unknown_sessions(auth):
    for session_id in ("", "made-up"):
        with pytest.raises(AuthError) as caught:
            auth.require_admin(session_id)
        assert caught.value.details["reason"] == "no_session"


def test_uc411_session_expires_after_idle_time(auth, clock):
    session_id = auth.login("admin", "s3cret-pass")
    clock.advance(20)
    auth.require_admin(session_id)  # activity extends the session
    clock.advance(29)
    auth.require_admin(session_id)
    clock.advance(31)
    with pytest.raises(AuthError) as caught:
        auth.require_admin(session_id)
    assert caught.value.details["reason"] == "expired"
    with pytest.raises(AuthError):
        auth.require_admin(session_id)


def test_uc411_ac1_logout_ends_the_session(auth):
    session_id = auth.login("admin", "s3cret-pass")
    auth.logout(session_id)
    auth.logout(session_id)
    with pytest.raises(AuthError):
        auth.require_admin(session_id)


def test_nfr531_password_is_only_kept_as_a_hash(services, config):
    auth = services["auth_service"]
    assert auth._password_hash and config["ADMIN_PASSWORD"] not in auth._password_hash
    assert auth._password_hash.startswith(("scrypt:", "pbkdf2:"))


def test_uc411_account_locks_after_repeated_failures(auth, clock):
    """UC-4.11 step 6: the account must not be locked."""
    for _ in range(5):
        with pytest.raises(AuthError, match="Invalid username or password"):
            auth.login("admin", "wrong")
    with pytest.raises(AuthError) as caught:
        auth.login("admin", "s3cret-pass")  # even the right password is refused while locked
    assert caught.value.details["reason"] == "locked"
    clock.advance(6)
    assert auth.login("admin", "s3cret-pass")


def test_uc411_successful_login_resets_the_failure_count(auth):
    for _ in range(4):
        with pytest.raises(AuthError):
            auth.login("admin", "wrong")
    auth.login("admin", "s3cret-pass")
    for _ in range(4):
        with pytest.raises(AuthError, match="Invalid"):
            auth.login("admin", "wrong")
    assert auth.login("admin", "s3cret-pass")
