"""Path resolution for dev mode vs release (frozen) mode.

Mirrors the Rust paths.rs: in dev mode paths are relative to the project
root; in frozen mode they are relative to the executable directory.
"""

import os
import sys
from pathlib import Path


def _is_frozen() -> bool:
    """True when running as a PyInstaller-frozen executable."""
    return getattr(sys, "frozen", False)


def app_dir() -> Path:
    """The app's root directory - where config.json lives.

    Dev:    project root (e.g. D:/IMPORTANT/python/DragonTranslator/)
    Frozen: directory containing the running exe
    """
    if _is_frozen():
        return Path(sys.executable).parent.resolve()
    else:
        # Running as `python -m dragon_translator` — __main__.py is inside
        # the dragon_translator package, so go up two levels to project root.
        return Path(__file__).resolve().parent.parent


def runtime_dir() -> Path:
    """Directory containing runtime resource files (piper/, piper-voices/,
    llamafile, default-config.json, etc.).

    Dev:    <project_root>/runtime/
    Frozen: same as app_dir() — files sit alongside the exe
    """
    if _is_frozen():
        return app_dir()
    else:
        return app_dir() / "runtime"


def logs_dir() -> Path:
    """Log output directory (logs/).

    Dev:    <project_root>/logs/
    Frozen: <exe_dir>/logs/
    """
    return app_dir() / "logs"


def web_dir() -> Path:
    """Directory containing Vite build output (index.html, assets/, bergamot/).

    Dev:    <project_root>/web/
    Frozen: <exe_dir>/web/
    """
    return app_dir() / "web"
