"""Local LLM process management.

Manages a llamafile-vulkan.exe subprocess
that serves an OpenAI-compatible API on a local TCP port.

Supports model download, listing, and deletion for .gguf files.
"""

import glob as glob_mod
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from src import logger, paths

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_PORT: int = 5158
LLAMAFILE_EXE: str = "llamafile-vulkan.exe"
DEFAULT_MODEL: str = "qwen3-0.6b-q4_k_m.gguf"

# Global state
_llama_process: subprocess.Popen | None = None
_llama_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------


def _llamafile_path() -> str:
    """Get the llamafile executable path, reading from llama-config.json if present."""
    exe_name = _read_llama_config_llamafile() or LLAMAFILE_EXE
    return str(paths.runtime_dir() / exe_name)


def _read_llama_config_llamafile() -> Optional[str]:
    """Read the llamafile exe name from llama-config.json."""
    config_path = paths.runtime_dir() / "llama-config.json"
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("llamafile")
    except (OSError, json.JSONDecodeError):
        return None


def _log_file() -> str:
    """Return the path to the current log file (used for subprocess stderr)."""
    logs = paths.logs_dir()
    os.makedirs(logs, exist_ok=True)
    filename = logger.get_log_filename() or "app.log"
    return str(logs / filename)


def _log(msg: str) -> None:
    """Log a message through the unified logger (console + app.log)."""
    logger.log(1, "llama", msg)


# ---------------------------------------------------------------------------
# atexit safeguard — kills llamafile on unexpected exit (crash, Ctrl+C, etc.)
# Registered once in start_local_model.
# ---------------------------------------------------------------------------

import atexit

_atexit_registered: bool = False


def _atexit_kill() -> None:
    """Called automatically on Python exit — ensures llamafile is stopped."""
    _log("atexit: stopping llamafile")
    _stop_process()


# ---------------------------------------------------------------------------
# Process management
# ---------------------------------------------------------------------------


def start_local_model(
    port: Optional[int] = None,
    model: Optional[str] = None,
    on_progress: Optional[Callable[[dict], None]] = None,
    on_complete: Optional[Callable[[dict], None]] = None,
) -> str:
    """Start the local llamafile model server.

    Args:
        port: TCP port for the API server (default 5158)
        model: Path to GGUF model file (default from runtime)
        on_progress: Optional callback for download progress
        on_complete: Optional callback for download complete

    Returns:
        Status message
    """
    global _llama_process
    port = port or DEFAULT_PORT

    _log(f"start_local_model called, port={port}, model={model}")

    # Check if already running
    if _is_port_open(port):
        _log("Port already open, model is running")
        return f"本地模型已在端口 {port} 运行"

    exe = _llamafile_path()
    model_name = model or DEFAULT_MODEL

    if not os.path.isabs(model_name):
        # Search both runtime/ and models/ for the GGUF file
        for search_dir in [paths.runtime_dir(), paths.models_dir()]:
            candidate = str(search_dir / model_name)
            if os.path.exists(candidate):
                model_path = candidate
                break
        else:
            model_path = str(paths.models_dir() / model_name)  # fallback
    else:
        model_path = model_name

    _log(f"llamafile path: {exe}")
    _log(f"Model path: {model_path}")

    if not os.path.exists(exe):
        msg = f"找不到 llamafile: {exe}"
        _log(f"Error: {msg}")
        raise FileNotFoundError(msg)
    if not os.path.exists(model_path):
        msg = f"找不到模型文件: {model_path}"
        _log(f"Error: {msg}")
        raise FileNotFoundError(msg)

    # Kill any leftover process
    _stop_process()

    # Build args
    args = [exe, "-m", model_path, "--port", str(port), "--host", "127.0.0.1"]
    _log(f"Launch command: {args}")

    try:
        child = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
    except OSError as e:
        msg = f"启动 llamafile 失败: {e}"
        _log(msg)
        raise RuntimeError(msg)

    # Tee stderr to both console and log file
    log_path = _log_file()
    def _tee_stderr() -> None:
        try:
            with open(log_path, "a", encoding="utf-8") as lf:
                for line in child.stderr:  # type: ignore[union-attr]
                    line = line.rstrip("\n")
                    print(f"[llamafile] {line}")
                    lf.write(f"[llamafile] {line}\n")
                    lf.flush()
        except Exception:
            pass
    threading.Thread(target=_tee_stderr, daemon=True, name="llama-stderr").start()

    pid = child.pid
    _log(f"Process started, PID={pid}")

    # Register atexit ONCE so llamafile is killed on ANY Python exit
    # (crash, KeyboardInterrupt, sys.exit — only os._exit bypasses this,
    # but our app_quit and _on_quit call stop_local_model before os._exit).
    global _atexit_registered
    if not _atexit_registered:
        atexit.register(_atexit_kill)
        _atexit_registered = True
        _log("atexit cleanup registered")

    with _llama_lock:
        _llama_process = child

    # Wait up to 60s for the server to become ready
    for i in range(240):
        time.sleep(0.25)

        # Check if child is still alive
        poll_result = child.poll()
        if poll_result is not None:
            with _llama_lock:
                _llama_process = None
            msg = f"llamafile 进程意外退出 (exit code: {poll_result}), 请检查 logs/app.log"
            _log(msg)
            raise RuntimeError(msg)

        if _is_port_open(port):
            elapsed = i * 0.25
            _log(f"Model ready, took ~{elapsed:.1f}s")
            return f"本地模型已启动 (端口 {port})"

        # Log progress every 10 seconds
        if i % 40 == 39:
            _log(f"Waiting... {(i + 1) * 0.25:.0f}s")

    # Timeout
    msg = f"本地模型启动超时 (端口 {port}, 60s). 请检查 logs/app.log"
    _log(msg)
    _stop_process()
    raise TimeoutError(msg)


def stop_local_model() -> str:
    """Stop the local llamafile model server."""
    _log("stop_local_model called")
    _stop_process()
    _log("Local model stopped")
    return "本地模型已停止"


def get_local_model_status(port: Optional[int] = None, model: str = "") -> dict[str, Any]:
    """Get the status of the local model."""
    port = port or DEFAULT_PORT
    return {
        "running": _is_port_open(port),
        "port": port,
        "model": model,
        "llamafile": LLAMAFILE_EXE,
    }


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------


def list_downloaded_models() -> list[dict[str, Any]]:
    """List all .gguf model files in both runtime/ and models/ directories."""
    models: list[dict[str, Any]] = []
    seen: set[str] = set()

    for search_dir in [str(paths.runtime_dir()), str(paths.models_dir())]:
        for path_str in glob_mod.glob(os.path.join(search_dir, "*.gguf")):
            name = os.path.basename(path_str)
            if name in seen:
                continue
            seen.add(name)
            size_bytes = os.path.getsize(path_str)
            models.append({"name": name, "size_bytes": size_bytes})

    models.sort(key=lambda m: m["name"])
    return models


def download_model(
    url: str,
    filename: str,
    on_progress: Optional[Callable[[dict], None]] = None,
    on_complete: Optional[Callable[[dict], None]] = None,
) -> str:
    """Download a GGUF model file using urllib (no extra deps).

    Downloads to a .tmp file in models/, then renames to the final
    filename on success.  On failure the .tmp is removed.

    Args:
        url: Download URL
        filename: Output filename (must end with .gguf)
        on_progress: Callback(dict) with {filename, downloaded, total}
        on_complete: Callback(dict) with {filename, size_bytes}

    Returns:
        Status message

    Raises:
        ValueError: If filename doesn't end with .gguf
    """
    import ssl
    import urllib.request
    import urllib.error

    # Safety: only allow .gguf files
    if not filename.endswith(".gguf"):
        raise ValueError("文件名必须以 .gguf 结尾")

    models_dir = str(paths.models_dir())
    dest = os.path.join(models_dir, filename)
    tmp_dest = dest + ".tmp"

    if os.path.exists(dest):
        return f"{filename} 已存在"

    # Ensure models/ exists
    os.makedirs(models_dir, exist_ok=True)

    _log(f"[{filename}] 开始下载")
    _log(f"[{filename}] url: {url[:80]}...")

    # Create SSL context that's more lenient with mirrors
    ssl_ctx = ssl.create_default_context()

    short_name = filename
    if len(short_name) > 40:
        short_name = short_name[:37] + "..."

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "DragonTranslator/0.7.0",
        })
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=30) as resp:
            _log(f"[{short_name}] response: status={resp.status}")
            total = int(resp.headers.get("Content-Length", 0))
            _log(f"[{short_name}] Content-Length: {total} bytes ({total / (1024*1024):.1f} MB)")

            downloaded = 0
            last_emit = 0
            last_log = 0

            with open(tmp_dest, "wb") as tmpf:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    tmpf.write(chunk)
                    downloaded += len(chunk)

                    # Emit progress ~every 1% (or every 5MB if total unknown)
                    emit_threshold = max(total // 100, 5 * 1024 * 1024) if total > 0 else 5 * 1024 * 1024
                    if on_progress and downloaded - last_emit >= emit_threshold:
                        last_emit = downloaded
                        on_progress({
                            "filename": filename,
                            "downloaded": downloaded,
                            "total": total,
                        })

                    # Log progress ~every 10MB to console
                    if downloaded - last_log >= 10 * 1024 * 1024:
                        last_log = downloaded
                        pct = f"{downloaded / total * 100:.0f}%" if total > 0 else "?"
                        _log(f"[{short_name}] {downloaded / (1024*1024):.1f} MB / {total / (1024*1024):.1f} MB ({pct})")

        # Download complete — rename .tmp to final filename
        size_bytes = os.path.getsize(tmp_dest)
        size_mb = size_bytes / (1024 * 1024)
        _log(f"[{short_name}] 下载完成, 移动 {tmp_dest} -> {dest}")
        os.replace(tmp_dest, dest)
        _log(f"[{short_name}] 已保存 ({size_mb:.1f} MB)")

        if on_complete:
            on_complete({
                "filename": filename,
                "size_bytes": size_bytes,
            })

        return f"下载完成 {filename} ({size_mb:.1f} MB)"

    except urllib.error.URLError as e:
        _log(f"[{short_name}] 下载失败 (网络错误): {e}")
        _cleanup_tmp(tmp_dest)
        raise RuntimeError(f"下载失败: {e}") from e
    except Exception as e:
        _log(f"[{short_name}] 下载失败: {e}")
        _cleanup_tmp(tmp_dest)
        raise


def _cleanup_tmp(path: str) -> None:
    """Remove a .tmp file if it exists."""
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def delete_model(filename: str) -> str:
    """Delete a .gguf model file.

    Raises:
        ValueError: If filename doesn't end with .gguf
        FileNotFoundError: If the model doesn't exist
    """
    if not filename.endswith(".gguf"):
        raise ValueError("只能删除 .gguf 文件")

    for search_dir in [paths.models_dir(), paths.runtime_dir()]:
        path = search_dir / filename
        if path.exists():
            os.remove(path)
            _log(f"已删除模型: {filename}")
            return f"已删除 {filename}"

    raise FileNotFoundError(f"模型不存在: {filename}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_port_open(port: int) -> bool:
    """Check if a TCP port is open on localhost."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except (OSError, ConnectionRefusedError, TimeoutError):
        return False


def _stop_process() -> None:
    """Kill the running llamafile process and all its children.

    Uses a layered approach:
    1. Kill by PID (if we have the Popen handle)
    2. Kill by image name (taskkill /IM) as a catch-all
    """
    global _llama_process

    # Layer 1: kill by PID if we have it
    with _llama_lock:
        if _llama_process is not None:
            pid = _llama_process.pid
            _log(f"Terminating process tree PID={pid}...")
            if os.name == "nt":
                try:
                    r = subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        capture_output=True, text=True,
                        creationflags=0x08000000,
                        timeout=10,
                    )
                    _log(f"taskkill /PID {pid}: {r.stdout.strip() or r.stderr.strip() or 'ok'}")
                except Exception as e:
                    _log(f"taskkill /PID {pid} error: {e}")
            try:
                _llama_process.kill()
                _llama_process.wait(timeout=5)
            except Exception:
                pass
            _llama_process = None

    # Layer 2: kill ALL llamafile processes by name (belt and suspenders)
    if os.name == "nt":
        _log("Killing any remaining llamafile-vulkan.exe processes by name...")
        try:
            r = subprocess.run(
                ["taskkill", "/F", "/IM", "llamafile-vulkan.exe", "/T"],
                capture_output=True, text=True,
                creationflags=0x08000000,
                timeout=10,
            )
            _log(f"taskkill /IM: {r.stdout.strip() or r.stderr.strip() or 'ok'}")
        except Exception as e:
            _log(f"taskkill /IM error: {e}")
