"""Exceptions raised by the control classes and adapters (docs/decisions.md #23).

The diagram's validate_* methods return None, so failures are raised. Flask routes translate each
exception into a JSON error and an HTTP status (see routes/serializers.py). Messages are written
for the end user: specific enough to act on, never a bare "an error occurred" (UC-4.7).
"""

from __future__ import annotations


class HougangError(Exception):
    """Base class. `fields` maps an input name to its message; `details` carries structured extras."""

    code = "error"

    def __init__(self, message: str, fields: dict[str, str] | None = None, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.fields = fields or {}
        self.details = details or {}


class ValidationError(HougangError):
    """Invalid filter, prediction input or uploaded file (UC-4.7 EX.1, UC-4.9 EX.1-3, UC-4.11 EX2)."""

    code = "validation_error"


class InsufficientDataError(HougangError):
    """Too little supporting data for a reliable estimate (UC-4.7 EX.3, Business Rule 5.5.2)."""

    code = "insufficient_data"


class NotFoundError(HougangError):
    """A requested record does not exist."""

    code = "not_found"


class AuthError(HougangError):
    """Missing, invalid or expired admin session, or wrong credentials (UC-4.11)."""

    code = "unauthorized"


class ModelUnavailableError(HougangError):
    """No fitted model is loaded (UC-4.8 EX.1, S10 "Unavailable model")."""

    code = "model_unavailable"


class DataSourceError(HougangError):
    """data.gov.sg or the local dataset cannot be reached (UC-4.1 EX.1, UC-4.10 EX.1)."""

    code = "data_source_unavailable"
