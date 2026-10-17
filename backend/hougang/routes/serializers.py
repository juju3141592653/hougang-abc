"""JSON serialisation of domain objects and errors for the Flask routes (architecture: "serialize results").

Errors always have the shape {"error": {"code", "message", "fields", "details"}} so the React pages
can show field-specific messages (E1-E4) on the current page.
"""

from __future__ import annotations

import logging
import math
import sqlite3
from dataclasses import asdict, is_dataclass

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from hougang.domain import TransactionPage
from hougang.errors import (
    AuthError,
    DataSourceError,
    HougangError,
    InsufficientDataError,
    ModelUnavailableError,
    NotFoundError,
    ValidationError,
)

logger = logging.getLogger(__name__)

HTTP_STATUS = {
    ValidationError: 400,
    AuthError: 401,
    NotFoundError: 404,
    InsufficientDataError: 422,
    ModelUnavailableError: 503,
    DataSourceError: 503,
}


def to_json(obj) -> dict:
    """Domain dataclass -> JSON-ready dict."""
    if isinstance(obj, TransactionPage):
        data = asdict(obj)
        data["total_pages"] = max(1, math.ceil(obj.total / obj.page_size)) if obj.page_size else 1
        return data
    if is_dataclass(obj):
        return asdict(obj)
    return obj


def error_response(code: str, message: str, status: int, fields: dict | None = None, details: dict | None = None):
    body = {"error": {"code": code, "message": message, "fields": fields or {}, "details": details or {}}}
    return jsonify(body), status


def register_error_handlers(app: Flask, max_upload_mb: int) -> None:
    """Translate exceptions into JSON errors."""

    @app.errorhandler(HougangError)
    def _hougang_error(exc: HougangError):
        status = next((s for cls, s in HTTP_STATUS.items() if isinstance(exc, cls)), 500)
        return error_response(exc.code, exc.message, status, exc.fields, exc.details)

    @app.errorhandler(sqlite3.Error)
    def _database_error(exc: sqlite3.Error):
        logger.exception("Database error")
        return error_response(
            DataSourceError.code, "The housing dataset is not available right now. Please try again later.", 503
        )

    @app.errorhandler(RequestEntityTooLarge)
    def _too_large(exc):
        return error_response(
            ValidationError.code,
            f"The file is larger than the {max_upload_mb} MB limit.",
            413,
            {"file": f"Maximum size is {max_upload_mb} MB"},
        )

    @app.errorhandler(HTTPException)
    def _http_error(exc: HTTPException):
        return error_response(exc.name.lower().replace(" ", "_"), exc.description or exc.name, exc.code or 500)

    @app.errorhandler(Exception)
    def _unexpected(exc: Exception):
        logger.exception("Unexpected error")
        return error_response("internal_error", "Something went wrong on our side. Please try again.", 500)
