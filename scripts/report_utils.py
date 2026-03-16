#!/usr/bin/env python3
"""Shared utility helpers for report-generation scripts."""

from typing import Any


def format_int(value: Any) -> str:
    """Format integer-like values with thousands separators."""
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value)
