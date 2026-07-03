"""Config seeding for first-run initialization.

Reads default-config.json from the runtime directory
directory, and creates config.json on first run.
"""

import json
from pathlib import Path

from src import paths, logger


def _read_seed_json(app_root: Path) -> str:
    """Read default-config.json, trying runtime_dir then app_dir."""
    runtime = paths.runtime_dir()
    path = runtime / "default-config.json"
    if path.exists():
        return path.read_text(encoding="utf-8")

    # Fallback: app dir (in frozen mode, runtime == app_dir)
    path = app_root / "default-config.json"
    if path.exists():
        return path.read_text(encoding="utf-8")

    raise FileNotFoundError("default-config.json 未找到")


def get_default_config_json() -> str:
    """Return the raw content of default-config.json for the frontend."""
    return _read_seed_json(paths.app_dir())


def seed_config(app_root: Path) -> None:
    """Seed config.json from default-config.json on first run.

    Wraps the JSON in {"app": ...} format for plugin-store compatibility
    The "app" wrapper matches the store format.
    """
    try:
        raw = _read_seed_json(app_root)
    except FileNotFoundError as e:
        msg = f"Config seed failed: {e}"
        print(f"[Setup] {msg}")
        logger.log(3, "app", msg)
        return

    config_path = app_root / "config.json"

    # Wrap in {"app": ...} if not already wrapped
    stripped = raw.strip()
    if stripped.startswith('{"app"'):
        wrapped = stripped
    else:
        wrapped = f'{{"app":{stripped}}}'

    try:
        config_path.write_text(wrapped, encoding="utf-8")
        msg = f"config.json seeded from default-config.json → {config_path}"
        print(f"[Setup] {msg}")
        logger.log(1, "app", msg)
    except OSError as e:
        msg = f"Write config.json failed: {e}"
        print(f"[Setup] {msg}")
        logger.log(3, "app", msg)
