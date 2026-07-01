"""Local LLM process management.

Mirrors the Rust llama_manager.rs: manages a llamafile-vulkan.exe subprocess
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

from dragon_translator import logger, paths

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
    logs = paths.logs_dir()
    os.makedirs(logs, exist_ok=True)
    return str(logs / "llama.log")


def _log(msg: str) -> None:
    """Log a message to both stdout and the llamafile log file."""
    print(f"[LocalModel] {msg}")
    try:
        with open(_log_file(), "a", encoding="utf-8") as f:
            ts = int(time.time())
            f.write(f"[{ts}] {msg}\n")
    except OSError:
        pass


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
        model_path = str(paths.runtime_dir() / model_name)
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

    # Open log file for llamafile's stderr
    try:
        err_log = open(_log_file(), "a")
    except OSError:
        err_log = subprocess.DEVNULL

    try:
        child = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=err_log,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
    except OSError as e:
        msg = f"启动 llamafile 失败: {e}"
        _log(msg)
        raise RuntimeError(msg)

    pid = child.pid
    _log(f"Process started, PID={pid}")

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
            msg = f"llamafile 进程意外退出 (exit code: {poll_result}), 请检查 logs/llama.log"
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
    msg = f"本地模型启动超时 (端口 {port}, 60s). 请检查 logs/llama.log"
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
    """List all .gguf model files in the runtime directory."""
    runtime = str(paths.runtime_dir())
    models: list[dict[str, Any]] = []

    for path_str in glob_mod.glob(os.path.join(runtime, "*.gguf")):
        name = os.path.basename(path_str)
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
    """Download a GGUF model file.

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
    import httpx

    # Safety: only allow .gguf files
    if not filename.endswith(".gguf"):
        raise ValueError("文件名必须以 .gguf 结尾")

    runtime = str(paths.runtime_dir())
    dest = os.path.join(runtime, filename)

    if os.path.exists(dest):
        return f"{filename} 已存在"

    _log(f"开始下载模型: {url} -> {filename}")

    with httpx.stream("GET", url, follow_redirects=True) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length", 0))

        downloaded = 0
        last_emit = 0
        chunks: list[bytes] = []

        for chunk in resp.iter_bytes(chunk_size=65536):
            chunks.append(chunk)
            downloaded += len(chunk)

            # Emit progress ~every 1%
            if total > 0 and on_progress and downloaded - last_emit > total // 100:
                last_emit = downloaded
                on_progress({
                    "filename": filename,
                    "downloaded": downloaded,
                    "total": total,
                })

        data = b"".join(chunks)

    with open(dest, "wb") as f:
        f.write(data)

    size_mb = len(data) / (1024 * 1024)
    _log(f"下载完成: {filename} ({size_mb:.1f} MB)")

    if on_complete:
        on_complete({
            "filename": filename,
            "size_bytes": len(data),
        })

    return f"下载完成 {filename} ({size_mb:.1f} MB)"


def delete_model(filename: str) -> str:
    """Delete a .gguf model file.

    Raises:
        ValueError: If filename doesn't end with .gguf
        FileNotFoundError: If the model doesn't exist
    """
    if not filename.endswith(".gguf"):
        raise ValueError("只能删除 .gguf 文件")

    path = paths.runtime_dir() / filename
    if not path.exists():
        raise FileNotFoundError(f"模型不存在: {filename}")

    os.remove(path)
    _log(f"已删除模型: {filename}")
    return f"已删除 {filename}"


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
    """Kill the running llamafile process."""
    global _llama_process
    with _llama_lock:
        if _llama_process is not None:
            pid = _llama_process.pid
            _log(f"Terminating process PID={pid}...")
            try:
                _llama_process.kill()
                _llama_process.wait(timeout=5)
            except Exception:
                pass
            _log("Process terminated")
            _llama_process = None
