"""
Minimal, dependency-free .env loader for the ingest scripts.

Importing this module reads KEY=VALUE lines from `ingest/.env` (which is
git-ignored and never committed) into os.environ. Keeps secrets —
PGPASSWORD, BEA_API_KEY — out of the source code and out of git history.

Usage (top of any ingest script):
    import _env   # noqa: F401  — populates os.environ from ingest/.env

Shell-provided environment variables take precedence (setdefault), so you
can also run without a .env file by exporting the vars yourself.
"""
import os
from pathlib import Path

_ENV_FILE = Path(__file__).with_name(".env")

if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())
