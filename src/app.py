"""Core application module.

Sets up the pywebview window, JS API bridge, system tray, global hotkey,
and application lifecycle.
"""

import json
import os
import subprocess
import sys
import threading
from collections import defaultdict
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, Callable

import webview

from src import logger, paths, user_files
from src.single_instance import ensure_single_instance, spawn_activate_listener

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FRONTEND_PORT = 5157
WINDOW_TITLE = "龙腾翻译"
WINDOW_WIDTH = 860
WINDOW_HEIGHT = 620
WINDOW_MIN_WIDTH = 600
WINDOW_MIN_HEIGHT = 420

# ---------------------------------------------------------------------------
# Key mapping
# ---------------------------------------------------------------------------

KEY_TO_VK: dict[str, int] = {}
MODIFIER_MAP: dict[str, int] = {}

if sys.platform == "win32":
    import win32con

    MODIFIER_MAP = {
        "ctrl": win32con.MOD_CONTROL,
        "alt": win32con.MOD_ALT,
        "shift": win32con.MOD_SHIFT,
        "meta": win32con.MOD_WIN,
        "win": win32con.MOD_WIN,
        "super": win32con.MOD_WIN,
    }

    # Windows Virtual-Key Codes (raw hex values — win32con lacks VK_* constants)
    KEY_TO_VK = {
        "A": 0x41, "B": 0x42, "C": 0x43, "D": 0x44, "E": 0x45,
        "F": 0x46, "G": 0x47, "H": 0x48, "I": 0x49, "J": 0x4A,
        "K": 0x4B, "L": 0x4C, "M": 0x4D, "N": 0x4E, "O": 0x4F,
        "P": 0x50, "Q": 0x51, "R": 0x52, "S": 0x53, "T": 0x54,
        "U": 0x55, "V": 0x56, "W": 0x57, "X": 0x58, "Y": 0x59,
        "Z": 0x5A,
        "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
        "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
        "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73,
        "F5": 0x74, "F6": 0x75, "F7": 0x76, "F8": 0x77,
        "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
        "SPACE": 0x20, "ENTER": 0x0D,
        "ESCAPE": 0x1B, "ESC": 0x1B,
        "TAB": 0x09,
    }


def parse_modifiers(mods: list[str]) -> int:
    """Convert modifier strings to Win32 modifier flags."""
    result = 0
    for m in mods:
        result |= MODIFIER_MAP.get(m.lower(), 0)
    return result


def parse_code(key: str) -> int:
    """Convert a key string to a Win32 virtual key code."""
    code = KEY_TO_VK.get(key.upper())
    if code is None:
        raise ValueError(f"不支持的按键: {key}")
    return code


# ---------------------------------------------------------------------------
# HTTP server for serving frontend static files
# ---------------------------------------------------------------------------

def _start_static_server(web_dir: Path) -> HTTPServer:
    """Start a local HTTP server to serve Vite build output.

    Uses a daemon thread. Serves static files from web_dir and also
    routes /llama-config.json and /default-config.json from runtime_dir().
    """

    _runtime_dir = paths.runtime_dir()

    class _Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any):
            super().__init__(*args, directory=str(web_dir), **kwargs)

        def log_message(self, format: str, *args: Any) -> None:
            pass

        def do_GET(self) -> None:
            path = self.path.split("?")[0]
            # Serve runtime JSON configs from runtime_dir
            if path in ("/llama-config.json", "/default-config.json"):
                filepath = _runtime_dir / path.lstrip("/")
                if filepath.exists():
                    try:
                        content = filepath.read_bytes()
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(content)))
                        self.send_header("Cache-Control", "no-cache")
                        self.end_headers()
                        self.wfile.write(content)
                        return
                    except OSError:
                        pass
                self.send_error(404)
                return
            if path == "/" or path == "/index.html":
                try:
                    index_path = web_dir / "index.html"
                    html = index_path.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(html)))
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    self.wfile.write(html)
                    return
                except OSError:
                    pass
            super().do_GET()

    server = HTTPServer(("127.0.0.1", FRONTEND_PORT), _Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True, name="static-server")
    t.start()
    return server


# ---------------------------------------------------------------------------
# JS API — exposed to frontend as window.pywebview.api.*
# ---------------------------------------------------------------------------

def _describe_value(value: Any) -> str:
    """Return a short description of a value for debug logging."""
    if isinstance(value, dict):
        keys = list(value.keys())
        return f"dict(keys={keys[:5]}{'...' if len(keys) > 5 else ''})"
    if isinstance(value, list):
        return f"list(len={len(value)})"
    if isinstance(value, str) and len(value) > 50:
        return f"str(len={len(value)})"
    return repr(value)[:80]


class JsApi:
    """Bridge between React frontend and Python backend.

    All public methods are callable from JavaScript via:
        window.pywebview.api.methodName(args)
    """

    def __init__(self) -> None:
        self._window: webview.Window | None = None
        self._event_queues: dict[str, list[Any]] = defaultdict(list)
        self._event_lock = threading.Lock()
        self._config_cache: dict[str, Any] = {}
        self._history_cache: dict[str, Any] = {}

        # Pre-load config into cache so store.get() works immediately
        config_path = paths.app_dir() / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    self._config_cache = json.load(f)
            except (OSError, json.JSONDecodeError):
                pass

        # Pre-load history into cache
        history_path = paths.app_dir() / "history.json"
        if history_path.exists():
            try:
                with open(history_path, "r", encoding="utf-8") as f:
                    self._history_cache = json.load(f)
            except (OSError, json.JSONDecodeError):
                pass

    def _set_window(self, window: webview.Window) -> None:
        """Called after window creation to set the window reference."""
        self._window = window

    # ---- Event system (polling-based) ----

    def emit(self, event: str, data: Any = None) -> None:
        """Push an event to the queue for frontend polling."""
        with self._event_lock:
            self._event_queues[event].append(data)

    def poll_events(self, event: Any = "") -> list[Any]:
        """Retrieve and clear queued events (called by frontend via setInterval)."""
        if isinstance(event, dict):
            event = event.get("event", "")
        with self._event_lock:
            events = self._event_queues.get(event, [])
            self._event_queues[event] = []
            return events

    def get_log_info(self, *_args: Any) -> dict:
        """Return the current log filename and logs directory path."""
        return {
            "filename": logger.get_log_filename(),
            "dir": str(paths.logs_dir()),
        }

    # ---- App info ----

    def get_app_dir(self, *_args: Any) -> str:
        """Return the app directory path (where config.json lives)."""
        return str(paths.app_dir())

    def get_default_config(self, *_args: Any) -> str:
        """Read and return default-config.json content."""
        return user_files.get_default_config_json()

    # ---- Logging ----

    def log_frontend(self, args: dict) -> None:
        """Log a message from the frontend.

        Args:
            args: {"level": "debug"|"info"|"warn"|"error", "message": "..."}
        """
        level_str = args.get("level", "info")
        level = {"debug": 0, "info": 1, "warn": 2, "error": 3}.get(level_str, 1)
        message = args.get("message", "")
        logger.log(level, "frontend", message)

    def set_log_level(self, level: Any = 1) -> None:
        """Set global log level. 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=OFF."""
        if isinstance(level, dict):
            level = level.get("level", 1)
        logger.set_level(int(level))

    # ---- File system ----

    def open_user_dir(self, *_args: Any) -> None:
        """Open the app directory in File Explorer."""
        dir_path = str(paths.app_dir())
        os.makedirs(dir_path, exist_ok=True)
        subprocess.Popen(["explorer", dir_path])

    def open_logs_dir(self, *_args: Any) -> None:
        """Open the logs directory in File Explorer."""
        dir_path = str(paths.logs_dir())
        os.makedirs(dir_path, exist_ok=True)
        subprocess.Popen(["explorer", dir_path])

    # ---- Config store (file-based JSON) ----

    def config_get(self, key: Any = "") -> Any:
        """Read a value from config.json.

        Called both directly (from bridge store.get) and via invoke().
        When called via invoke(), key may be a dict like {"key": "app"}.
        """
        if isinstance(key, dict):
            key = key.get("key", "")
        config_path = paths.app_dir() / "config.json"
        try:
            if config_path.exists():
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                value = data.get(str(key))
                if value is not None:
                    line = f"config_get({key}): found ({_describe_value(value)})"
                else:
                    line = f"config_get({key}): key not in file (top-level keys: {list(data.keys())})"
                print(f"[Config] {line}")
                logger.log(1, "config", line)
                return value
            else:
                logger.log(1, "config", f"config_get({key}): config.json not found at {config_path}")
        except json.JSONDecodeError as e:
            logger.log(3, "config", f"config_get({key}): JSON parse error: {e}")
        except OSError as e:
            logger.log(3, "config", f"config_get({key}): IO error: {e}")
        return None

    def config_set(self, args: dict) -> None:
        """Set a value in the in-memory config cache (written on config_save).

        Args:
            args: {"key": "app", "value": {...}}
        """
        key = args.get("key", "")
        value = args.get("value")
        if key:
            self._config_cache[key] = value
            print(f"[Config] config_set({key}): cached ({_describe_value(value)})")
            logger.log(1, "config", f"config_set({key}): cached ({_describe_value(value)})")

    def config_save(self, *_args: Any) -> None:
        """Write the in-memory config cache to config.json atomically.

        Writes to a .tmp file first, then os.replace() to the final path.
        This prevents file corruption if the write is interrupted.
        """
        config_path = paths.app_dir() / "config.json"
        tmp_path = config_path.with_suffix(".json.tmp")
        try:
            # Merge with existing data
            existing: dict[str, Any] = {}
            if config_path.exists():
                try:
                    with open(config_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except (OSError, json.JSONDecodeError):
                    logger.log(2, "config", "config.json unreadable, starting fresh")

            existing.update(self._config_cache)
            self._config_cache = dict(existing)

            # Atomic write: tmp → rename
            os.makedirs(config_path.parent, exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, config_path)

            print(f"[Config] config_save: wrote {len(existing)} keys to {config_path}")
            logger.log(1, "config", f"config_save: wrote {len(existing)} keys to {config_path}")
        except OSError as e:
            logger.log(3, "app", f"config_save failed: {e}")
            # Clean up tmp file on failure
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass

    # ---- History store (file-based JSON, separate from config) ----

    def history_get(self, *_args: Any) -> Any:
        """Read the history.json file and return its content.

        Returns {"sessions": [...]} or an empty dict if no history exists.
        """
        history_path = paths.app_dir() / "history.json"
        try:
            if history_path.exists():
                with open(history_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                logger.log(1, "history", f"history_get: loaded {len(data.get('sessions', []))} sessions")
                return data
        except (json.JSONDecodeError, OSError) as e:
            logger.log(3, "history", f"history_get failed: {e}")
        return {"sessions": []}

    def history_set(self, args: dict) -> None:
        """Cache history data in memory (written on history_save).

        Args:
            args: {"sessions": [...]}
        """
        sessions = args.get("sessions", [])
        self._history_cache["sessions"] = sessions
        logger.log(1, "history", f"history_set: cached {len(sessions)} sessions")

    def history_save(self, *_args: Any) -> None:
        """Write the in-memory history cache to history.json atomically."""
        history_path = paths.app_dir() / "history.json"
        tmp_path = history_path.with_suffix(".json.tmp")
        try:
            # Merge with existing data
            existing: dict[str, Any] = {}
            if history_path.exists():
                try:
                    with open(history_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except (OSError, json.JSONDecodeError):
                    logger.log(2, "history", "history.json unreadable, starting fresh")

            existing.update(self._history_cache)
            self._history_cache = dict(existing)

            # Atomic write: tmp → rename
            os.makedirs(history_path.parent, exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, history_path)

            logger.log(1, "history", f"history_save: wrote {len(existing.get('sessions', []))} sessions to {history_path}")
        except OSError as e:
            logger.log(3, "app", f"history_save failed: {e}")
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass

    def _win(self) -> Any:
        """Get the current window, with fallback."""
        w = self._window or webview.active_window()
        if w is None:
            raise RuntimeError("Window not available")
        return w

    # ---- Window control ----
    # NOTE: method names are prefixed with window_ to avoid shadowing
    # any built-in methods on pywebview's js_api proxy.

    def app_quit(self, *_args: Any) -> None:
        """Completely exit the application: stop models, unregister hotkey,
        stop tray icon, and terminate the process."""
        logger.log(1, "app", "User requested app quit from frontend")
        # Stop local model
        try:
            from src.llama_manager import stop_local_model
            stop_local_model()
        except Exception as e:
            logger.log(3, "app", f"stop_local_model failed: {e}")
        # Unregister hotkey
        if _hotkey_state is not None:
            _hotkey_state.unregister()
        # Stop tray icon
        tray_icon = _tray_state.get("icon")
        if tray_icon is not None:
            try:
                tray_icon.stop()
            except Exception:
                pass
        # Hard exit
        os._exit(0)

    def window_minimize(self, *_args: Any) -> None:
        self._win().minimize()

    def window_hide(self, *_args: Any) -> None:
        """Hide window to tray."""
        global _window_hidden
        self._win().hide()
        _window_hidden = True

    def window_close(self, *_args: Any) -> None:
        self._win().destroy()

    def hide(self, *_args: Any) -> None:
        global _window_hidden
        print(f"[WinCtrl] hide() called")
        self._win().hide()
        _window_hidden = True

    def show(self, *_args: Any) -> None:
        global _window_hidden
        print(f"[WinCtrl] show() called")
        self._win().show()
        _window_hidden = False

    def restore(self, *_args: Any) -> None:
        global _window_hidden
        self._win().restore()
        _window_hidden = False

    def focus(self, *_args: Any) -> None:
        global _window_hidden
        w = self._win()
        w.restore()
        w.show()
        _window_hidden = False

    # ---- Global shortcut ----

    def configure_shortcut(self, args: dict) -> None:
        """Register a global hotkey from the frontend.

        Args:
            args: {"modifiers": ["Ctrl", "Alt"], "key": "X"}
        """
        modifiers = args.get("modifiers", [])
        key = args.get("key", "")
        print(f"[Shortcut] configure_shortcut called: modifiers={modifiers} key={key}")

        if not key:
            print("[Shortcut] No key provided, unregistering")
            if _hotkey_state is not None:
                _hotkey_state.unregister()
            return

        try:
            mod_flags = parse_modifiers(modifiers)
            vk = parse_code(key)
            print(f"[Shortcut] Parsed: mod_flags={mod_flags:#x} vk={vk:#x}")
        except ValueError as e:
            print(f"[Shortcut] Parse error: {e}")
            return

        if _hotkey_state is not None:
            print(f"[Shortcut] Calling _hotkey_state.register({mod_flags:#x}, {vk:#x})")
            _hotkey_state.register(mod_flags, vk)
        else:
            print("[Shortcut] ERROR: _hotkey_state is None!")

    def get_shortcut(self, *_args: Any) -> dict:
        """Return the currently registered shortcut."""
        if _hotkey_state is not None:
            return _hotkey_state.to_dict()
        return {"modifiers": [], "key": ""}

    # ---- Local LLM model (delegated to llama_manager) ----

    def start_local_model(self, args: dict | None = None) -> str:
        from src.llama_manager import start_local_model
        args = args or {}
        return start_local_model(
            port=args.get("port"),
            model=args.get("model"),
            on_progress=lambda p: self.emit("model_download_progress", p),
            on_complete=lambda p: self.emit("model_download_complete", p),
        )

    def stop_local_model(self, *_args: Any) -> str:
        from src.llama_manager import stop_local_model
        return stop_local_model()

    def get_local_model_status(self, args: dict | None = None) -> dict:
        from src.llama_manager import get_local_model_status
        args = args or {}
        return get_local_model_status(
            port=args.get("port"),
            model=args.get("model", ""),
        )

    def diagnose_environment(self, args: dict | None = None) -> dict:
        """Run system diagnostics for troubleshooting llamafile startup.
        Returns a dict with detailed environment info.
        """
        from src.llama_manager import diagnose_environment
        args = args or {}
        return diagnose_environment(model=args.get("model"))

    def list_downloaded_models(self, *_args: Any) -> list[dict]:
        from src.llama_manager import list_downloaded_models
        return list_downloaded_models()

    def download_model(self, args: dict) -> str:
        """Start model download in background thread.

        Returns immediately; progress and completion are delivered via
        poll_events (model_download_progress / model_download_complete).
        The download runs in a daemon thread so it doesn't block the
        RPC event loop (which would prevent poll_events from working).
        """
        from src.llama_manager import download_model

        url = args.get("url", "")
        filename = args.get("filename", "")

        def _bg_download() -> None:
            try:
                result = download_model(
                    url=url,
                    filename=filename,
                    on_progress=lambda p: self.emit("model_download_progress", p),
                    on_complete=lambda p: self.emit("model_download_complete", p),
                )
                logger.log(1, "app", f"Model download: {result}")
            except Exception as e:
                logger.log(3, "app", f"Model download failed: {e}")
                self.emit("model_download_error", {"filename": filename, "error": str(e)})

        threading.Thread(target=_bg_download, daemon=True, name="model-download").start()
        return f"开始下载 {filename}"

    def delete_model(self, filename: Any = "") -> str:
        from src.llama_manager import delete_model
        if isinstance(filename, dict):
            filename = filename.get("filename", "")
        return delete_model(str(filename))

    # ---- TTS (delegated to tts module) ----

    def tts_speak(self, args: dict) -> None:
        from src.tts import tts_speak
        tts_speak(
            text=args.get("text", ""),
            lang=args.get("lang", ""),
            voice=args.get("voice"),
            on_complete=lambda: self.emit("tts_complete"),
        )

    def tts_stop(self, *_args: Any) -> None:
        from src.tts import tts_stop
        tts_stop()

    def tts_get_voices(self, *_args: Any) -> list[dict]:
        from src.tts import list_voices
        return list_voices()

    def tts_get_voices_dir(self, *_args: Any) -> str:
        from src.tts import voices_dir
        return voices_dir()

    def tts_open_voices_dir(self, *_args: Any) -> None:
        from src.tts import open_voices_dir

    def tts_download_voice(self, args: dict) -> str:
        """Start voice download in background thread.

        Returns immediately; progress and completion are delivered via
        poll_events (voice_download_progress / voice_download_complete).
        Downloads both .onnx.json (instant) and .onnx (streaming).
        """
        from src.tts import download_voice

        url_base = args.get("url_base", "")
        voice_name = args.get("voice_name", "")

        print(f"[Bridge] tts_download_voice CALLED url_base={url_base[:80]}... voice_name={voice_name}")
        logger.log(1, "app", f"tts_download_voice: voice_name={voice_name} url_base={url_base[:100]}")

        def _bg_download() -> None:
            try:
                print(f"[Bridge] _bg_download THREAD STARTED for {voice_name}")
                result = download_voice(
                    url_base=url_base,
                    voice_name=voice_name,
                    on_progress=lambda p: self.emit("voice_download_progress", p),
                    on_complete=lambda p: self.emit("voice_download_complete", p),
                )
                print(f"[Bridge] _bg_download SUCCESS: {result}")
                logger.log(1, "app", f"Voice download: {result}")
            except Exception as e:
                print(f"[Bridge] _bg_download ERROR: {e}")
                logger.log(3, "app", f"Voice download failed: {e}")
                self.emit("voice_download_error", {"voice_name": voice_name, "error": str(e)})

        threading.Thread(target=_bg_download, daemon=True, name="voice-download").start()
        return f"开始下载 {voice_name}"

    def tts_delete_voice(self, name: Any = "") -> str:
        from src.tts import delete_voice
        if isinstance(name, dict):
            name = name.get("name", "")
        return delete_voice(str(name))


# ---------------------------------------------------------------------------
# Global hotkey management
# ---------------------------------------------------------------------------

class _HotkeyState:
    """Manages a registered global hotkey using Win32 RegisterHotKey.

    Runs a message-only window in a background thread to receive WM_HOTKEY.
    """

    def __init__(self, callback: Callable[[], None]) -> None:
        self._modifiers: int = 0
        self._vk: int = 0
        self._registered: bool = False
        self._id: int = 1
        self._callback = callback
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def register(self, modifiers: int, vk: int) -> None:
        """Register a new hotkey (unregisters previous)."""
        import win32gui

        print(f"[Shortcut] _HotkeyState.register: mod={modifiers:#x} vk={vk:#x}")
        self.unregister()

        if modifiers == 0 and vk == 0:
            print("[Shortcut] Skipping: modifiers and vk are both 0")
            return

        self._modifiers = modifiers
        self._vk = vk
        self._stop_event.clear()

        def _pump() -> None:
            import win32api
            import win32con
            import win32event
            import win32gui

            print("[Shortcut] _pump thread started")

            # Register window class with proper hInstance
            wc = win32gui.WNDCLASS()
            wc.lpfnWndProc = self._wnd_proc
            wc.lpszClassName = "DragonTranslatorHotkey"
            wc.hInstance = win32api.GetModuleHandle(None)
            try:
                win32gui.RegisterClass(wc)
                print("[Shortcut] WNDCLASS registered")
            except Exception as e:
                print(f"[Shortcut] RegisterClass: {e} (may already exist)")

            hwnd = win32gui.CreateWindow(
                "DragonTranslatorHotkey", "DragonTranslatorHotkey",
                0, 0, 0, 0, 0, None, None, wc.hInstance, None
            )
            print(f"[Shortcut] Message-only window created: hwnd={hwnd}")

            try:
                # RegisterHotKey returns None on success in pywin32 (not truthy!)
                # So we must NOT check the return value with 'if not'
                win32gui.RegisterHotKey(hwnd, self._id, self._modifiers, self._vk)
                self._registered = True
                print(f"[Shortcut] RegisterHotKey SUCCESS: mod={self._modifiers:#x} vk={self._vk:#x}")

                # Message pump
                print("[Shortcut] Starting message pump...")
                while not self._stop_event.is_set():
                    result = win32event.MsgWaitForMultipleObjects(
                        [], False, 200,
                        win32con.QS_HOTKEY | win32con.QS_ALLINPUT
                    )
                    if result == win32event.WAIT_OBJECT_0:
                        win32gui.PumpWaitingMessages()
                print("[Shortcut] Message pump stopped (stop_event set)")
            except Exception as e:
                print(f"[Shortcut] Hotkey registration/loop error: {e}")
                import traceback
                traceback.print_exc()
            finally:
                if self._registered:
                    try:
                        win32gui.UnregisterHotKey(hwnd, self._id)
                        print("[Shortcut] Hotkey unregistered")
                    except Exception:
                        pass  # already unregistered or window gone
                    self._registered = False
                try:
                    win32gui.DestroyWindow(hwnd)
                    print("[Shortcut] Window destroyed, _pump exiting")
                except Exception:
                    pass

        self._thread = threading.Thread(target=_pump, daemon=True, name="hotkey-pump")
        self._thread.start()
        print(f"[Shortcut] _pump thread launched: alive={self._thread.is_alive()}")

    def unregister(self) -> None:
        """Stop the hotkey pump thread."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1)
        self._registered = False

    def to_dict(self) -> dict:
        """Return current hotkey as {modifiers, key} for frontend."""
        # Reverse-map VK to key name
        reverse = {v: k for k, v in KEY_TO_VK.items()}
        key_name = reverse.get(self._vk, "")
        # Reverse-map modifier flags
        reverse_mod = {v: k for k, v in MODIFIER_MAP.items()}
        mods = []
        for flag, name in reversed_mod.items():
            if self._modifiers & flag:
                mods.append(name.title())
        return {"modifiers": mods, "key": key_name}

    @staticmethod
    def _wnd_proc(hwnd: Any, msg: Any, wparam: Any, lparam: Any) -> Any:
        import win32con
        import win32gui

        if msg == win32con.WM_HOTKEY:
            print(f"[Shortcut] WM_HOTKEY received! wparam={wparam} lparam={lparam}")
            if _hotkey_state is not None:
                print("[Shortcut] Calling toggle callback...")
                _hotkey_state._callback()
                print("[Shortcut] Toggle callback returned")
            else:
                print("[Shortcut] ERROR: _hotkey_state is None in WM_HOTKEY!")
            return 0
        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)


# Global hotkey state (initialized during setup)
_hotkey_state: _HotkeyState | None = None


# ---------------------------------------------------------------------------
# System tray (pystray)
# ---------------------------------------------------------------------------

def _create_tray_icon(on_show: Callable[[], None], on_quit: Callable[[], None]) -> None:
    """Create system tray icon with show/quit menu."""
    from PIL import Image
    import pystray

    # Load icon
    icon_path = Path(__file__).parent / "icon.ico"
    try:
        image = Image.open(icon_path)
    except Exception:
        # Fallback: create a simple colored square
        image = Image.new("RGBA", (32, 32), (59, 130, 246, 255))

    def _on_show(icon: pystray.Icon, item: Any) -> None:
        on_show()

    def _on_quit(icon: pystray.Icon, item: Any) -> None:
        icon.stop()
        on_quit()

    def _on_left_click(icon: pystray.Icon, button: int, time: int) -> None:
        on_show()

    menu = pystray.Menu(
        pystray.MenuItem("显示窗口", _on_show, default=True),
        pystray.MenuItem("退出", _on_quit),
    )

    icon = pystray.Icon(
        "DragonTranslator",
        image,
        "龙图腾翻译",
        menu,
    )

    # Run in background thread
    t = threading.Thread(target=icon.run, daemon=True, name="tray")
    t.start()

    # Store for cleanup
    _tray_state["icon"] = icon


_tray_state: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

def _setup_app() -> None:
    """Initialize logs, seed config, and set up directories."""
    # Create log directory
    logs = paths.logs_dir()
    try:
        os.makedirs(logs, exist_ok=True)
    except OSError as e:
        print(f"[Setup] ERROR: Cannot create log dir '{logs}': {e}")

    logger.init_logs(str(logs))
    logger.log(1, "app", f"App starting — logs: {logs}")

    # Seed config.json from default-config.json on first run
    app_root = paths.app_dir()
    config_path = app_root / "config.json"
    if not config_path.exists():
        logger.log(1, "app", f"config.json not found at {config_path}, seeding...")
        user_files.seed_config(app_root)
    else:
        logger.log(1, "app", f"config.json found at {config_path}")


# Module-level window reference (set in run(), used by _toggle_window/_show_window)
_app_window: webview.Window | None = None
_window_hidden: bool = False  # track manually because pywebview's .visible is unreliable


def _toggle_window() -> None:
    """Toggle window visibility (for hotkey + tray left-click)."""
    global _window_hidden
    print(f"[Shortcut] _toggle_window() called, _window_hidden={_window_hidden}")
    try:
        w = _app_window
        if w is None:
            w = webview.active_window()
        if w is None:
            print("[Shortcut] ERROR: no window reference available")
            return
        if not _window_hidden:
            print("[Shortcut] Hiding window...")
            w.hide()
            _window_hidden = True
        else:
            print("[Shortcut] Showing window...")
            w.show()
            w.restore()
            _window_hidden = False
        print("[Shortcut] _toggle_window() done")
    except Exception as e:
        print(f"[Shortcut] _toggle_window error: {e}")
        import traceback
        traceback.print_exc()


def _show_window() -> None:
    """Show and focus the window."""
    global _window_hidden
    print("[Tray] _show_window() called")
    try:
        w = _app_window
        if w is None:
            w = webview.active_window()
        if w is None:
            print("[Tray] ERROR: no window reference available")
            return
        print("[Tray] Showing window...")
        w.show()
        w.restore()
        _window_hidden = False
        print("[Tray] _show_window() done")
    except Exception as e:
        print(f"[Tray] _show_window error: {e}")
        import traceback
        traceback.print_exc()


def run() -> None:
    """Main entry point. Sets up and runs the Dragon Translator app."""

    # ---- Single instance check ----
    if not ensure_single_instance():
        print("Another instance is already running. Exiting.")
        # Clean up any leftover subprocess (llamafile)
        try:
            from src.llama_manager import stop_local_model
            stop_local_model()
        except Exception:
            pass
        return

    # ---- Setup ----
    _setup_app()

    # ---- Static file server ----
    web_dir = paths.web_dir()
    # Ensure web/ has at least an index.html placeholder
    if not (web_dir / "index.html").exists():
        os.makedirs(web_dir, exist_ok=True)
        (web_dir / "index.html").write_text(
            "<html><body><h1>Frontend not built</h1>"
            "<p>Run: cd frontend && npm install && npm run build</p>"
            "</body></html>",
            encoding="utf-8",
        )
    server = _start_static_server(web_dir)
    logger.log(1, "app", f"Static server started on http://127.0.0.1:{FRONTEND_PORT}")

    # ---- JS API (created before window so it can be passed as js_api) ----
    api = JsApi()

    # ---- Create window ----
    window = webview.create_window(
        title=WINDOW_TITLE,
        url=f"http://127.0.0.1:{FRONTEND_PORT}/index.html",
        js_api=api,            # pywebview 6.x: expose API object at creation time
        width=WINDOW_WIDTH,
        height=WINDOW_HEIGHT,
        min_size=(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT),
        frameless=True,        # Custom title bar (React TitleBar)
        easy_drag=False,       # We use CSS -webkit-app-region: drag instead
        text_select=False,     # We handle text selection in JS/CSS
    )

    if window is None:
        logger.log(3, "app", "Failed to create window")
        return

    # Store window reference globally (for hotkey/tray toggle)
    global _app_window
    _app_window = window

    # Set window reference on API now that window exists
    api._set_window(window)

    # ---- Global hotkey ----
    global _hotkey_state
    _hotkey_state = _HotkeyState(callback=_toggle_window)
    print(f"[Shortcut] _HotkeyState initialized: {_hotkey_state}")
    # (hotkey will be registered by the frontend's useEffect on startup)

    # ---- Single-instance activation listener ----
    spawn_activate_listener(on_activate=_show_window)

    # ---- System tray ----
    def _on_quit() -> None:
        """Clean up and exit."""
        try:
            from src.llama_manager import stop_local_model
            stop_local_model()
        except Exception:
            pass
        if _hotkey_state:
            _hotkey_state.unregister()
        os._exit(0)

    _create_tray_icon(on_show=_show_window, on_quit=_on_quit)
    logger.log(1, "app", "System tray created")

    # ---- Start ----
    logger.log(1, "app", "Starting webview...")
    _debug = os.environ.get("PYWEBVIEW_DEBUG", "").lower() in ("1", "true", "yes")
    webview.start(debug=_debug)

    # ---- Cleanup on exit ----
    if _hotkey_state:
        _hotkey_state.unregister()
    try:
        from src.llama_manager import stop_local_model
        stop_local_model()
    except Exception:
        pass
