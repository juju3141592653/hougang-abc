"""Admin API and session checks (architecture: "Login / logout / upload / model diagnostics").

Every protected route calls AdminAuthService.require_admin() before doing anything (UC-4.11,
SRS 4.11.3.4: direct URL requests are refused too). The session id travels in the
`Authorization: Bearer <session id>` header.
"""

from __future__ import annotations

import logging
from functools import wraps

from flask import Blueprint, current_app, jsonify, request

from hougang.errors import HougangError, ValidationError
from hougang.routes.serializers import to_json

logger = logging.getLogger(__name__)

bp = Blueprint("admin_api", __name__, url_prefix="/api/admin")


def _service(name: str):
    return current_app.extensions["hougang"][name]


def _session_id() -> str:
    header = request.headers.get("Authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else ""


def admin_required(view):
    """Run AdminAuthService.require_admin() first; a missing or expired session gives 401 (-> S7)."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        _service("auth_service").require_admin(_session_id())
        return view(*args, **kwargs)

    return wrapper


def _retrain_after(summary: dict) -> dict:
    """Refit the model when new rows arrived (docs/decisions.md #14)."""
    summary["model_retrained"] = False
    if summary.get("rows_added"):
        try:
            _service("prediction_manager").retrain()
            summary["model_retrained"] = True
        except HougangError as exc:
            logger.warning("Retrain after update failed: %s", exc.message)
            summary["model_message"] = exc.message
        except Exception:  # the import itself succeeded; report the retrain problem, don't fail the request
            logger.exception("Retrain after update failed")
            summary["model_message"] = "The data was imported, but the model could not be retrained. Try again later."
    return summary


@bp.post("/login")
def login():
    """UC-4.11 steps 3-7: verify credentials, start a session (S7 -> S8, or E3)."""
    body = request.get_json(silent=True) or {}
    auth = _service("auth_service")
    session_id = auth.login(str(body.get("username") or ""), str(body.get("password") or ""))
    return jsonify({"session_id": session_id, "idle_timeout_minutes": current_app.config["SESSION_IDLE_MINUTES"]})


@bp.post("/logout")
def logout():
    """UC-4.11 AC.1: end the session (S8 "Logout to public search")."""
    _service("auth_service").logout(_session_id())
    return jsonify({"logged_out": True})


@bp.get("/status")
@admin_required
def dataset_status():
    """S8: dataset status, last successful update, runs that need attention (UC-4.10 REQ-3/4)."""
    return jsonify({**_service("dataset_manager").get_status(), "max_upload_mb": current_app.config["UPLOAD_LIMIT_MB"]})


@bp.post("/dataset")
@admin_required
def upload_dataset():
    """UC-4.9: validate and import an uploaded .csv / .xlsx (S9 -> S9a, or E4)."""
    file = request.files.get("file")
    if file is None or not file.filename:
        raise ValidationError("Choose a .csv or .xlsx file to upload.", fields={"file": "No file chosen"})
    summary = _service("dataset_manager").import_file(file)
    return jsonify(_retrain_after(summary))


@bp.post("/dataset/check")
@admin_required
def check_dataset():
    """UC-4.9 "check": validate an uploaded file without importing it (S9; E4 on failure)."""
    file = request.files.get("file")
    if file is None or not file.filename:
        raise ValidationError("Choose a .csv or .xlsx file to check.", fields={"file": "No file chosen"})
    return jsonify(_service("dataset_manager").check_file(file))


@bp.post("/update-from-api")
@admin_required
def update_from_api():
    """UC-4.10 on demand (decisions #25): same code path as the daily job."""
    return jsonify(_retrain_after(_service("dataset_manager").update_from_api()))


@bp.get("/diagnostics")
@admin_required
def model_diagnostics():
    """UC-4.8: R², adjusted R², RMSE, coefficients and p-values (S10). 503 if no model (EX.1)."""
    return jsonify(to_json(_service("prediction_manager").get_diagnostics()))
