"""File-based logging with runtime level control.

Mirrors the Rust logger.rs: writes timestamped log lines to per-tag log files
under <app_dir>/logs/. Supports runtime log level changes.
"""

import os
import time
import threading
from pathlib import Path

# 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=OFF
_level: int = 1  # default: INFO
_level_lock = threading.Lock()
_initialized: bool = False
_init_lock = threading.Lock()


def set_level(level: int) -> None:
    """Set global log level. 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=OFF."""
    global _level
    clamped = min(level, 4)
    with _level_lock:
        _level = clamped


def _get_logs_dir() -> Path:
    """Lazy import to avoid circular dependency at module load time."""
    from dragon_translator.paths import logs_dir
    return logs_dir()


def init_logs(log_dir: str) -> None:
    """Initialize log directory. Called once at startup."""
    global _initialized
    with _init_lock:
        if _initialized:
            return
        try:
            os.makedirs(log_dir, exist_ok=True)
        except OSError as e:
            print(f"[Logger] WARNING: Cannot create log dir '{log_dir}': {e}")
        _initialized = True


def log(level: int, tag: str, msg: str) -> None:
    """Main log function - filters by level, writes to file and prints to stdout.

    Args:
        level: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR
        tag: log file tag (writes to logs/<tag>.log)
        msg: the message to log
    """
    # Filter by current level
    with _level_lock:
        current_level = _level
    if level < current_level:
        return

    level_str = {0: "DEBUG", 1: "INFO", 2: "WARN", 3: "ERROR"}.get(level, "?")
    ts = int(time.time())
    line = f"[{ts}] [{level_str}] {msg}\n"

    # Always print to stdout
    print(line, end="")

    # Write to file
    try:
        logs = _get_logs_dir()
        os.makedirs(logs, exist_ok=True)
        path = logs / f"{tag}.log"
        with open(path, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError as e:
        print(f"[Logger] WARNING: Cannot write to log: {e}")


def write_raw(tag: str, content: str) -> None:
    """Write raw subprocess stderr to a log file (always, regardless of level).

    Args:
        tag: log file tag (writes to logs/<tag>.log)
        content: raw text to write
    """
    try:
        logs = _get_logs_dir()
        os.makedirs(logs, exist_ok=True)
        path = logs / f"{tag}.log"
        ts = int(time.time())
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"--- {ts} ---\n{content.strip()}\n")
    except OSError as e:
        print(f"[Logger] WARNING: Cannot write raw to log: {e}")
