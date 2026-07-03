"""Local LLM process management.

Manages a llamafile-vulkan.exe subprocess
that serves an OpenAI-compatible API on a local TCP port.

Supports model download, listing, and deletion for .gguf files.
"""

import glob as glob_mod
import json
import os
import platform
import socket
import subprocess
import sys
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


# ---------------------------------------------------------------------------
# Stderr buffer — captures last N lines of llamafile output for diagnostics
# ---------------------------------------------------------------------------

_stderr_tail: list[str] = []
_stderr_tail_max = 50


def _get_stderr_tail() -> str:
    """Return the captured stderr tail as a string."""
    return "\n".join(_stderr_tail)


# ---------------------------------------------------------------------------
# Environment diagnostics
# ---------------------------------------------------------------------------


def diagnose_environment(model: Optional[str] = None) -> dict[str, Any]:
    """Collect system diagnostics for troubleshooting llamafile startup.

    Returns a dict with keys:
        system, python, llamafile_exe, model_file, port,
        vulkan_dll, running_processes, errors
    """
    diag: dict[str, Any] = {
        "system": {},
        "python": {},
        "llamafile_exe": {},
        "model_file": {},
        "port": {},
        "vulkan_dll": {},
        "running_processes": [],
        "errors": [],
    }

    # ---- System info ----
    try:
        diag["system"] = {
            "os": platform.system(),
            "os_release": platform.release(),
            "os_version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor() or "unknown",
        }
    except Exception as e:
        diag["errors"].append(f"system info: {e}")

    # ---- Python info ----
    try:
        diag["python"] = {
            "version": sys.version,
            "executable": sys.executable,
            "arch": platform.architecture()[0],
            "is_frozen": getattr(sys, "frozen", False),
        }
    except Exception as e:
        diag["errors"].append(f"python info: {e}")

    # ---- llamafile executable ----
    try:
        exe_path = _llamafile_path()
        diag["llamafile_exe"]["path"] = exe_path
        diag["llamafile_exe"]["expected_name"] = _read_llama_config_llamafile() or LLAMAFILE_EXE
        if os.path.exists(exe_path):
            st = os.stat(exe_path)
            diag["llamafile_exe"]["exists"] = True
            diag["llamafile_exe"]["size_bytes"] = st.st_size
            diag["llamafile_exe"]["size_mb"] = round(st.st_size / (1024 * 1024), 1)
        else:
            diag["llamafile_exe"]["exists"] = False
            diag["errors"].append(f"llamafile not found: {exe_path}")
    except Exception as e:
        diag["llamafile_exe"]["error"] = str(e)
        diag["errors"].append(f"llamafile exe check: {e}")

    # ---- Model file ----
    try:
        model_name = model or DEFAULT_MODEL
        diag["model_file"]["requested"] = model_name
        model_path = None
        for search_dir in [paths.runtime_dir(), paths.models_dir()]:
            candidate = str(search_dir / model_name) if not os.path.isabs(model_name) else model_name
            diag["model_file"][f"search_{search_dir.name}"] = {
                "path": candidate,
                "exists": os.path.exists(candidate),
            }
            if os.path.exists(candidate) and model_path is None:
                model_path = candidate
                st = os.stat(candidate)
                diag["model_file"]["found_path"] = model_path
                diag["model_file"]["size_bytes"] = st.st_size
                diag["model_file"]["size_mb"] = round(st.st_size / (1024 * 1024), 1)
        if model_path is None:
            diag["model_file"]["found"] = False
            diag["errors"].append(f"Model not found: {model_name} (searched runtime/ and models/)")
        else:
            diag["model_file"]["found"] = True
    except Exception as e:
        diag["model_file"]["error"] = str(e)
        diag["errors"].append(f"model file check: {e}")

    # ---- Port ----
    try:
        diag["port"]["port"] = DEFAULT_PORT
        port_open = _is_port_open(DEFAULT_PORT)
        diag["port"]["is_open"] = port_open
        if port_open:
            diag["port"]["note"] = "Port is already in use — another process may be listening"
    except Exception as e:
        diag["port"]["error"] = str(e)
        diag["errors"].append(f"port check: {e}")

    # ---- Vulkan DLL ----
    try:
        if os.name == "nt":
            # Try to find vulkan-1.dll in standard locations
            vulkan_paths = []
            # Check PATH
            for p in os.environ.get("PATH", "").split(os.pathsep):
                candidate = os.path.join(p, "vulkan-1.dll")
                if os.path.exists(candidate):
                    vulkan_paths.append(candidate)
            # Check System32
            system32 = os.path.join(os.environ.get("SystemRoot", "C:\\Windows"), "System32")
            candidate = os.path.join(system32, "vulkan-1.dll")
            if os.path.exists(candidate) and candidate not in vulkan_paths:
                vulkan_paths.append(candidate)

            diag["vulkan_dll"]["found"] = len(vulkan_paths) > 0
            diag["vulkan_dll"]["paths"] = vulkan_paths[:5]
            if not vulkan_paths:
                diag["vulkan_dll"]["note"] = (
                    "vulkan-1.dll not found in PATH or System32. "
                    "llamafile-vulkan.exe requires the Vulkan loader. "
                    "Install from: https://vulkan.lunarg.com/sdk/home"
                )
                diag["errors"].append("vulkan-1.dll not found — llamafile-vulkan.exe may not work")
    except Exception as e:
        diag["vulkan_dll"]["error"] = str(e)

    # ---- Running processes ----
    try:
        if os.name == "nt":
            import subprocess as sp
            r = sp.run(
                ["tasklist", "/FI", "IMAGENAME eq llamafile-vulkan.exe", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=5,
                creationflags=0x08000000,
            )
            lines = [l.strip().strip('"') for l in r.stdout.strip().split("\n") if l.strip()]
            # Filter out "INFO:" header lines (tasklist writes "INFO: No tasks..." when no match)
            real_processes = [l for l in lines if "llamafile" in l.lower()]
            diag["running_processes"] = real_processes if real_processes else []
            if real_processes:
                diag["errors"].append(
                    f"{len(real_processes)} orphan llamafile process(es) found — may block port"
                )
    except Exception as e:
        diag["running_processes"] = [f"check error: {e}"]

    # ---- Smoke test: try running llamafile --help (checks AV blocking, missing DLLs) ----
    try:
        exe_path = diag["llamafile_exe"].get("path", "")
        if exe_path and os.path.exists(exe_path):
            import subprocess as sp
            r = sp.run(
                [exe_path, "--help"],
                capture_output=True, text=True, timeout=15,
                creationflags=0x08000000,
            )
            diag["smoke_test"] = {
                "exit_code": r.returncode,
                "stderr_tail": r.stderr.strip()[-500:] if r.stderr else "",
                "stdout_tail": r.stdout.strip()[-500:] if r.stdout else "",
            }
            if r.returncode != 0 and not r.stderr and not r.stdout:
                diag["smoke_test"]["note"] = (
                    "Binary produced no output and non-zero exit. "
                    "This may indicate: anti-virus blocking, missing VC++ runtime, "
                    "or missing Vulkan loader (even though vulkan-1.dll was found, "
                    "the Vulkan driver may be missing or incompatible)."
                )
                diag["errors"].append(
                    f"Smoke test FAILED: llamafile exited with code {r.returncode}, no output"
                )
            elif r.returncode == 0:
                diag["smoke_test"]["status"] = "ok"
    except sp.TimeoutExpired:
        diag["smoke_test"] = {"status": "timeout", "note": "llamafile hung during smoke test"}
    except FileNotFoundError:
        diag["smoke_test"] = {"status": "not_found", "note": "llamafile could not be executed"}
    except OSError as e:
        diag["smoke_test"] = {"status": "os_error", "note": str(e)}
        diag["errors"].append(f"Smoke test OS error: {e}")
    except Exception as e:
        diag["smoke_test"] = {"status": "error", "note": str(e)}

    return diag


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

    Raises:
        FileNotFoundError: llamafile exe or model not found
        RuntimeError: process exited unexpectedly (includes stderr tail)
        TimeoutError: server didn't become ready within 60s
    """
    global _llama_process, _stderr_tail
    port = port or DEFAULT_PORT

    # ---- Clear stderr buffer for this run ----
    _stderr_tail = []

    # ---- Step logs (detailed for customer diagnostics) ----
    _log("=" * 50)
    _log(f"[STEP 1/7] start_local_model called")
    _log(f"  port={port}, model={model or '(default)'}")
    _log(f"  python={sys.version.split()[0]}, platform={platform.system()} {platform.release()}")
    _log(f"  frozen={getattr(sys, 'frozen', False)}, cwd={os.getcwd()}")

    # ---- STEP 2: Check port availability ----
    _log(f"[STEP 2/7] Checking port {port}...")
    port_is_open = _is_port_open(port)
    _log(f"  Port {port} open: {port_is_open}")
    if port_is_open:
        _log("  -> Port already in use, returning 'already running'")
        return f"本地模型已在端口 {port} 运行"

    # ---- STEP 3: Locate llamafile executable ----
    _log(f"[STEP 3/7] Locating llamafile executable...")
    exe = _llamafile_path()
    exe_exists = os.path.exists(exe)
    exe_size_mb = round(os.path.getsize(exe) / (1024 * 1024), 1) if exe_exists else 0
    _log(f"  Path: {exe}")
    _log(f"  Exists: {exe_exists}, Size: {exe_size_mb} MB")
    if not exe_exists:
        # Check runtime_dir contents for debugging
        runtime_files = os.listdir(str(paths.runtime_dir())) if paths.runtime_dir().exists() else []
        exe_files = [f for f in runtime_files if f.endswith('.exe')]
        _log(f"  Runtime dir exe files: {exe_files}")
        msg = f"找不到 llamafile: {exe}"
        _log(f"  [FAIL] {msg}")
        raise FileNotFoundError(msg)

    # ---- STEP 4: Locate model file ----
    _log(f"[STEP 4/7] Locating model file...")
    model_name = model or DEFAULT_MODEL
    _log(f"  Requested model: {model_name}")

    if not os.path.isabs(model_name):
        model_path = None
        for search_dir in [paths.runtime_dir(), paths.models_dir()]:
            candidate = str(search_dir / model_name)
            candidate_exists = os.path.exists(candidate)
            candidate_size_mb = round(os.path.getsize(candidate) / (1024 * 1024), 1) if candidate_exists else 0
            _log(f"  Search {search_dir.name}/: {candidate} -> exists={candidate_exists}, size={candidate_size_mb}MB")
            if candidate_exists and model_path is None:
                model_path = candidate
        if model_path is None:
            # List available .gguf files for debugging
            gguf_files = []
            for sd in [paths.runtime_dir(), paths.models_dir()]:
                if sd.exists():
                    gguf_files.extend(str(p.name) for p in sd.glob("*.gguf"))
            _log(f"  Available .gguf files: {gguf_files}")
            model_path = str(paths.models_dir() / model_name)  # fallback for error msg
    else:
        model_path = model_name

    model_exists = os.path.exists(model_path)
    model_size_mb = round(os.path.getsize(model_path) / (1024 * 1024), 1) if model_exists else 0
    _log(f"  Resolved path: {model_path}")
    _log(f"  Exists: {model_exists}, Size: {model_size_mb}MB")

    if not model_exists:
        msg = f"找不到模型文件: {model_path}"
        _log(f"  [FAIL] {msg}")
        raise FileNotFoundError(msg)

    # ---- STEP 5: Kill leftover processes ----
    _log(f"[STEP 5/7] Cleaning up leftover processes...")
    _stop_process()

    # ---- STEP 6: Launch llamafile ----
    _log(f"[STEP 6/7] Launching llamafile...")
    args = [exe, "--server", "-m", model_path, "--port", str(port), "--host", "127.0.0.1"]
    _log(f"  Command: {' '.join(args)}")

    try:
        child = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,        # Prevent stdin EOF from killing server mode
            stdout=subprocess.PIPE,          # Capture BOTH stdout and stderr
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
    except OSError as e:
        msg = f"启动 llamafile 子进程失败 (OSError): {e}"
        _log(f"  [FAIL] {msg}")
        _log(f"  stderr tail: {_get_stderr_tail()}")
        raise RuntimeError(msg)

    pid = child.pid
    _log(f"  Process spawned, PID={pid}")

    # Register atexit ONCE so llamafile is killed on ANY Python exit
    global _atexit_registered
    if not _atexit_registered:
        atexit.register(_atexit_kill)
        _atexit_registered = True
        _log("  atexit cleanup registered")

    with _llama_lock:
        _llama_process = child

    # Read BOTH stdout and stderr into log file + stderr buffer + console
    log_path = _log_file()

    def _capture_output(pipe: Any, label: str, lf: Any) -> None:
        """Read lines from a pipe and write to file/buffer/console."""
        for line in pipe:
            line = line.rstrip("\n")
            entry = f"[llamafile:{label}] {line}"
            # Write to log file (UTF-8, never throws encoding errors)
            try:
                lf.write(entry + "\n")
                lf.flush()
            except Exception:
                pass
            # Capture to tail buffer for diagnostics
            _stderr_tail.append(entry)
            if len(_stderr_tail) > _stderr_tail_max:
                _stderr_tail.pop(0)
            # Console (best-effort, may fail on GBK encoding)
            try:
                print(entry)
            except Exception:
                pass

    def _monitor_process() -> None:
        """Monitor child process — log exit code when it dies."""
        try:
            rc = child.wait()
            _log(f"llamafile process PID={pid} exited with code {rc}")
            # Small delay to let capture threads finish reading pipes
            time.sleep(0.3)
            if rc != 0:
                _log(f"CRASH DETECTED — last {min(10, len(_stderr_tail))} output lines:")
                for line in _stderr_tail[-10:]:
                    _log(f"  {line}")
        except Exception:
            pass

    def _tee_outputs() -> None:
        """Tee child's stdout + stderr to log file, buffer, and console."""
        try:
            with open(log_path, "a", encoding="utf-8") as lf:
                t1 = threading.Thread(target=_capture_output, args=(child.stdout, "out", lf), daemon=True)
                t2 = threading.Thread(target=_capture_output, args=(child.stderr, "err", lf), daemon=True)
                t1.start()
                t2.start()
                t1.join()
                t2.join()
        except Exception:
            pass

    threading.Thread(target=_tee_outputs, daemon=True, name="llama-tee").start()
    threading.Thread(target=_monitor_process, daemon=True, name="llama-monitor").start()

    # ---- STEP 7: Wait for server ready ----
    _log(f"[STEP 7/7] Waiting for server to bind port {port} (max 60s)...")
    for i in range(240):
        time.sleep(0.25)

        # Check if child is still alive
        poll_result = child.poll()
        if poll_result is not None:
            with _llama_lock:
                _llama_process = None
            # Give stderr thread a moment to capture last lines
            time.sleep(0.3)
            stderr_info = _get_stderr_tail()
            if stderr_info:
                stderr_preview = "\n".join(stderr_info[-10:])  # last 10 lines
                _log(f"  [FAIL] Process exit code: {poll_result}")
                _log(f"  Last stderr lines:\n{stderr_preview}")
                msg = (
                    f"llamafile 进程意外退出 (exit code: {poll_result}).\n"
                    f"--- llamafile stderr (最后 {min(10, len(stderr_info))} 行) ---\n"
                    f"{stderr_preview}\n"
                    f"--- 完整日志: logs/app.log ---"
                )
            else:
                _log(f"  [FAIL] Process exit code: {poll_result} (no stderr output)")
                msg = (
                    f"llamafile 进程意外退出 (exit code: {poll_result}), 无输出.\n"
                    f"请检查 logs/app.log 获取详细信息"
                )
            raise RuntimeError(msg)

        if _is_port_open(port):
            elapsed = i * 0.25
            _log(f"  [OK] Server ready on port {port}, took ~{elapsed:.1f}s")
            return f"本地模型已启动 (端口 {port})"

        # Log progress every 5 seconds (more frequent for diagnostics)
        if i % 20 == 19:
            elapsed = (i + 1) * 0.25
            stderr_count = len(_stderr_tail)
            _log(f"  Waiting... {elapsed:.0f}s (stderr lines captured: {stderr_count})")

    # Timeout
    _log(f"  [FAIL] Timeout after 60s — server never bound port {port}")
    stderr_info = _get_stderr_tail()
    if stderr_info:
        stderr_preview = "\n".join(stderr_info[-10:])
        _log(f"  Last stderr lines:\n{stderr_preview}")
    else:
        stderr_preview = "(无输出)"
        _log("  No stderr output captured")

    _stop_process()
    msg = (
        f"本地模型启动超时 (60s, 端口 {port}).\n"
        f"--- llamafile stderr (最后几行) ---\n"
        f"{stderr_preview}\n"
        f"--- 完整日志: logs/app.log ---"
    )
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
