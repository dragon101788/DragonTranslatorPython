"""File-based logging with runtime level control.

All logs go to a single timestamped file under <app_dir>/logs/.
Supports runtime log level changes.
"""

import os
import sys
import time
import threading
from datetime import datetime
from pathlib import Path

# 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=OFF
_level: int = 1  # default: INFO
_level_lock = threading.Lock()
_initialized: bool = False
_init_lock = threading.Lock()
_log_filename: str = ""  # set by init_logs


def get_log_filename() -> str:
    """Return the current log filename (e.g. '2026-07-03_14-30-00.log')."""
    return _log_filename


def set_level(level: int) -> None:
    """Set global log level. 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=OFF."""
    global _level
    clamped = min(level, 4)
    with _level_lock:
        _level = clamped


def _get_logs_dir() -> Path:
    """Lazy import to avoid circular dependency at module load time."""
    from src.paths import logs_dir
    return logs_dir()


def init_logs(log_dir: str) -> None:
    """Initialize log directory and generate timestamped filename."""
    global _initialized, _log_filename
    with _init_lock:
        if _initialized:
            return
        try:
            os.makedirs(log_dir, exist_ok=True)
        except OSError as e:
            print(f"[Logger] WARNING: Cannot create log dir '{log_dir}': {e}")
        _log_filename = datetime.now().strftime("%Y-%m-%d_%H-%M-%S") + ".log"
        _initialized = True


def log(level: int, tag: str, msg: str) -> None:
    """Write a log line to file and stdout.

    Args:
        level: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR
        tag: logical category (e.g. "app", "config", "llama")
        msg: the message to log
    """
    with _level_lock:
        current_level = _level
    if level < current_level:
        return

    level_str = {0: "DEBUG", 1: "INFO", 2: "WARN", 3: "ERROR"}.get(level, "?")
    ts = int(time.time())
    line = f"[{ts}] [{level_str}] [{tag}] {msg}\n"
    try:
        print(line, end="")
    except UnicodeEncodeError:
        # Console encoding (e.g. GBK on Chinese Windows) may not support
        # all characters — strip non-encodable chars and retry
        print(line.encode(sys.stdout.encoding or "utf-8", errors="replace").decode(
            sys.stdout.encoding or "utf-8", errors="replace"
        ), end="")

    try:
        logs = _get_logs_dir()
        os.makedirs(logs, exist_ok=True)
        path = logs / (_log_filename or "app.log")
        with open(path, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        print(f"[Logger] ERROR writing to {_log_filename or 'app.log'}: {e}")


def write_raw(tag: str, content: str) -> None:
    """Write raw subprocess stderr to both console and log file."""
    ts = int(time.time())
    header = f"--- [{tag}] {ts} ---"
    body = content.strip()
    try:
        print(f"{header}\n{body}")
    except UnicodeEncodeError:
        enc = sys.stdout.encoding or "utf-8"
        print(f"{header}\n{body}".encode(enc, errors="replace").decode(enc, errors="replace"))
    try:
        logs = _get_logs_dir()
        os.makedirs(logs, exist_ok=True)
        path = logs / (_log_filename or "app.log")
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{header}\n{body}\n")
    except Exception as e:
        print(f"[Logger] ERROR writing raw to {_log_filename or 'app.log'}: {e}")
