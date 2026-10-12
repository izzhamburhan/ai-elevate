"""Domain errors and the tool wrapper that turns them into structured results.

Tools never raise to the MCP client: an AppError becomes
{"ok": false, "error": {"code": ..., "message": ...}} so an agent can reason
about the failure. Anything unexpected becomes code "internal_error"."""

import functools
import logging
from typing import Callable

logger = logging.getLogger(__name__)


class AppError(Exception):
    code = "app_error"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class NotFoundError(AppError):
    code = "not_found"


class ValidationError(AppError):
    code = "validation_error"


class AuthError(AppError):
    code = "auth_error"


class UpstreamError(AppError):
    code = "upstream_error"


def error_result(code: str, message: str) -> dict:
    return {"ok": False, "error": {"code": code, "message": message}}


def safe_tool(fn: Callable) -> Callable:
    """Catch errors inside a tool and return them as data."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except AppError as exc:
            return error_result(exc.code, exc.message)
        except Exception:  # noqa: BLE001 - last-resort guard for the agent
            logger.exception("tool %s failed", fn.__name__)
            return error_result("internal_error", f"{fn.__name__} failed unexpectedly")

    return wrapper


def require(value, name: str):
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValidationError(f"'{name}' is required")
    return value


def one_of(value: str, allowed: list[str] | tuple[str, ...], name: str) -> str:
    v = (value or "").strip().lower()
    if v not in allowed:
        raise ValidationError(f"'{name}' must be one of: {', '.join(allowed)} (got '{value}')")
    return v
