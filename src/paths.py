"""Path resolution for dev mode vs release (frozen) mode.

Path resolution for dev mode vs release (frozen) mode.
root; in frozen mode they are relative to the executable directory.
"""

import os
import sys
from pathlib import Path


def _is_frozen() -> bool:
    """True when running as a PyInstaller-frozen executable."""
    return getattr(sys, "frozen", False)


def app_dir() -> Path:
    """The app's root directory — where config.json and logs live.

    Dev:    project root (e.g. D:/IMPORTANT/python/DragonTranslator/)
    Frozen: directory containing the running exe
    """
    if _is_frozen():
        return Path(sys.executable).parent.resolve()
    else:
        return Path(__file__).resolve().parent.parent


def runtime_dir() -> Path:
    """PyInstaller contents directory (piper, llamafile, web, python).

    Dev:    <project_root>/runtime/
    Frozen: sys._MEIPASS (= dist/runtime/, the contents_directory)
    """
    if _is_frozen():
        return Path(sys._MEIPASS).resolve()
    else:
        return app_dir() / "runtime"


def models_dir() -> Path:
    """User-downloaded models (.gguf, piper-voices/*.onnx).

    Dev:    <project_root>/models/
    Frozen: alongside exe (dist/models/)
    """
    return app_dir() / "models"


def logs_dir() -> Path:
    """Log output directory (logs/). Always alongside exe."""
    return app_dir() / "logs"


def web_dir() -> Path:
    """Vite build output (index.html, assets/, bergamot/).

    Dev:    <project_root>/runtime/web/
    Frozen: inside runtime/ (via PyInstaller datas)
    """
    return runtime_dir() / "web"
