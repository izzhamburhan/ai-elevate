"""Typed contracts for demo-mcp responses (the `data` field of the envelope)."""

from __future__ import annotations

from pydantic import BaseModel


class ClockState(BaseModel):
    t_min: int
    at: str


class ResetResult(BaseModel):
    cleared: dict[str, int]
    clock: ClockState
