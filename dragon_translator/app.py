"""Core application module.

Mirrors the Rust lib.rs: sets up the pywebview window, JS API bridge,
system tray, global hotkey, and application lifecycle.
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

from dragon_translator import logger, paths, user_files
from dragon_translator.single_instance import ensure_single_instance, spawn_activate_listener

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
# Key mapping (mirrors Rust parse_code)
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

    Uses a daemon thread. Required because pywebview cannot serve WASM
    files via file:// due to CORS restrictions (Bergamot NMT needs fetch()).
    """

    class _Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any):
            super().__init__(*args, directory=str(web_dir), **kwargs)

        def log_message(self, format: str, *args: Any) -> None:
            # Suppress HTTP request logging noise
            pass

    server = HTTPServer(("127.0.0.1", FRONTEND_PORT), _Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True, name="static-server")
    t.start()
    return server


# ---------------------------------------------------------------------------
# JS API — exposed to frontend as window.pywebview.api.*
# ---------------------------------------------------------------------------

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

        # Pre-load config into cache so store.get() works immediately
        config_path = paths.app_dir() / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    self._config_cache = json.load(f)
            except (OSError, json.JSONDecodeError):
                pass

    def _set_window(self, window: webview.Window) -> None:
        """Called after window creation to set the window reference."""
        self._window = window

    # ---- Event system (polling-based, replaces Tauri emit/listen) ----

    def emit(self, event: str, data: Any = None) -> None:
        """Push an event to the queue for frontend polling."""
        with self._event_lock:
            self._event_queues[event].append(data)

    def poll_events(self, event: str) -> list[Any]:
        """Retrieve and clear queued events (called by frontend via setInterval)."""
        with self._event_lock:
            events = self._event_queues.get(event, [])
            self._event_queues[event] = []
            return events

    # ---- App info ----

    def get_app_dir(self) -> str:
        """Return the app directory path (where config.json lives)."""
        return str(paths.app_dir())

    def get_default_config(self) -> str:
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

    def set_log_level(self, level: int) -> None:
        """Set global log level. 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=OFF."""
        logger.set_level(level)

    # ---- File system ----

    def open_user_dir(self) -> None:
        """Open the app directory in File Explorer."""
        dir_path = str(paths.app_dir())
        os.makedirs(dir_path, exist_ok=True)
        subprocess.Popen(["explorer", dir_path])

    # ---- Config store (file-based JSON, replaces tauri-plugin-store) ----

    def config_get(self, key: str) -> Any:
        """Read a value from config.json."""
        config_path = paths.app_dir() / "config.json"
        try:
            if config_path.exists():
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data.get(key)
        except (OSError, json.JSONDecodeError):
            pass
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

    def config_save(self) -> None:
        """Write the in-memory config cache to config.json."""
        config_path = paths.app_dir() / "config.json"
        try:
            # Merge with existing data
            existing: dict[str, Any] = {}
            if config_path.exists():
                try:
                    with open(config_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except (OSError, json.JSONDecodeError):
                    pass

            existing.update(self._config_cache)
            self._config_cache = dict(existing)

            os.makedirs(config_path.parent, exist_ok=True)
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logger.log(3, "app", f"config_save failed: {e}")

    def _win(self) -> Any:
        """Get the current window, with fallback."""
        w = self._window or webview.active_window()
        if w is None:
            raise RuntimeError("Window not available")
        return w

    # ---- Window control ----

    def minimize(self) -> None:
        self._win().minimize()

    def toggleMaximize(self) -> None:
        w = self._win()
        if getattr(w, "maximized", False):
            w.restore()
        else:
            w.maximize()

    def close(self) -> None:
        self._win().destroy()

    def hide(self) -> None:
        self._win().hide()

    def show(self) -> None:
        self._win().show()

    def restore(self) -> None:
        self._win().restore()

    def focus(self) -> None:
        w = self._win()
        w.restore()
        w.show()

    # ---- Global shortcut ----

    def configure_shortcut(self, args: dict) -> None:
        """Register a global hotkey from the frontend.

        Args:
            args: {"modifiers": ["Ctrl", "Alt"], "key": "X"}
        """
        modifiers = args.get("modifiers", [])
        key = args.get("key", "")

        if not key:
            if _hotkey_state is not None:
                _hotkey_state.unregister()
            return

        try:
            mod_flags = parse_modifiers(modifiers)
            vk = parse_code(key)
        except ValueError as e:
            print(f"[Shortcut] {e}")
            return

        if _hotkey_state is not None:
            _hotkey_state.register(mod_flags, vk)

    def get_shortcut(self) -> dict:
        """Return the currently registered shortcut."""
        if _hotkey_state is not None:
            return _hotkey_state.to_dict()
        return {"modifiers": [], "key": ""}

    # ---- Local LLM model (delegated to llama_manager) ----

    def start_local_model(self, args: dict | None = None) -> str:
        from dragon_translator.llama_manager import start_local_model
        args = args or {}
        return start_local_model(
            port=args.get("port"),
            model=args.get("model"),
            on_progress=lambda p: self.emit("model_download_progress", p),
            on_complete=lambda p: self.emit("model_download_complete", p),
        )

    def stop_local_model(self) -> str:
        from dragon_translator.llama_manager import stop_local_model
        return stop_local_model()

    def get_local_model_status(self, args: dict | None = None) -> dict:
        from dragon_translator.llama_manager import get_local_model_status
        args = args or {}
        return get_local_model_status(
            port=args.get("port"),
            model=args.get("model", ""),
        )

    def list_downloaded_models(self) -> list[dict]:
        from dragon_translator.llama_manager import list_downloaded_models
        return list_downloaded_models()

    def download_model(self, args: dict) -> str:
        from dragon_translator.llama_manager import download_model
        return download_model(
            url=args["url"],
            filename=args["filename"],
            on_progress=lambda p: self.emit("model_download_progress", p),
            on_complete=lambda p: self.emit("model_download_complete", p),
        )

    def delete_model(self, filename: str) -> str:
        from dragon_translator.llama_manager import delete_model
        return delete_model(filename)

    # ---- TTS (delegated to tts module) ----

    def tts_speak(self, args: dict) -> None:
        from dragon_translator.tts import tts_speak
        tts_speak(
            text=args.get("text", ""),
            lang=args.get("lang", ""),
            voice=args.get("voice"),
            on_complete=lambda: self.emit("tts_complete"),
        )

    def tts_stop(self) -> None:
        from dragon_translator.tts import tts_stop
        tts_stop()

    def tts_get_voices(self) -> list[dict]:
        from dragon_translator.tts import list_voices
        return list_voices()

    def tts_get_voices_dir(self) -> str:
        from dragon_translator.tts import voices_dir
        return voices_dir()

    def tts_open_voices_dir(self) -> None:
        from dragon_translator.tts import open_voices_dir

    def tts_download_voice(self, args: dict) -> str:
        from dragon_translator.tts import download_voice
        return download_voice(url=args["url"], filename=args["filename"])

    def tts_delete_voice(self, name: str) -> str:
        from dragon_translator.tts import delete_voice
        return delete_voice(name)


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

        self.unregister()

        if modifiers == 0 and vk == 0:
            return

        self._modifiers = modifiers
        self._vk = vk
        self._stop_event.clear()

        def _pump() -> None:
            import win32con
            import win32gui

            # Create a message-only window
            wc = win32gui.WNDCLASS()
            wc.lpfnWndProc = self._wnd_proc
            wc.lpszClassName = "DragonTranslatorHotkey"
            try:
                win32gui.RegisterClass(wc)
            except Exception:
                pass  # already registered

            hwnd = win32gui.CreateWindow(
                "DragonTranslatorHotkey", "DragonTranslatorHotkey",
                0, 0, 0, 0, 0, None, None, wc.hInstance, None
            )

            try:
                if not win32gui.RegisterHotKey(hwnd, self._id, self._modifiers, self._vk):
                    print(f"[Shortcut] RegisterHotKey failed: mod={self._modifiers} vk={self._vk}")
                    return
                self._registered = True
                print(f"[Shortcut] Hotkey registered: mod={self._modifiers} vk={self._vk}")

                # Message pump
                while not self._stop_event.is_set():
                    # Use MsgWaitForMultipleObjects to be interruptible
                    result = win32gui.MsgWaitForMultipleObjects(
                        [], False, 200,
                        win32con.QS_HOTKEY | win32con.QS_ALLINPUT
                    )
                    if result == win32con.WAIT_OBJECT_0:
                        win32gui.PumpWaitingMessages()
            finally:
                if self._registered:
                    win32gui.UnregisterHotKey(hwnd, self._id)
                    self._registered = False
                win32gui.DestroyWindow(hwnd)

        self._thread = threading.Thread(target=_pump, daemon=True, name="hotkey-pump")
        self._thread.start()

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
            # Hotkey pressed — call the toggle callback
            if _hotkey_state is not None:
                _hotkey_state._callback()
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


def _toggle_window() -> None:
    """Toggle window visibility (for hotkey + tray left-click)."""
    try:
        window = webview.active_window()
        if window is None:
            return
        if window.visible and not window.minimized:
            window.hide()
        else:
            window.show()
            window.restore()
    except Exception:
        pass


def _show_window() -> None:
    """Show and focus the window."""
    try:
        window = webview.active_window()
        if window is None:
            return
        window.show()
        window.restore()
    except Exception:
        pass


def run() -> None:
    """Main entry point. Sets up and runs the Dragon Translator app."""

    # ---- Single instance check ----
    if not ensure_single_instance():
        print("Another instance is already running. Exiting.")
        # Clean up any leftover subprocess (llamafile)
        try:
            from dragon_translator.llama_manager import stop_local_model
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

    # Set window reference on API now that window exists
    api._set_window(window)

    # ---- Inject __TAURI_INTERNALS__ after page load ----
    # (Must be done via events.loaded because evaluate_js only works
    #  AFTER webview.start() has created the native window.)
    def _inject_tauri_internals() -> None:
        try:
            window.evaluate_js("""
                window.__TAURI_INTERNALS__ = {
                    metadata: { isPywebview: true, pythonVersion: "0.7.0" }
                };
            """)
        except Exception:
            pass

    window.events.loaded += _inject_tauri_internals

    # ---- Global hotkey ----
    global _hotkey_state
    _hotkey_state = _HotkeyState(callback=_toggle_window)

    # ---- Single-instance activation listener ----
    spawn_activate_listener(on_activate=_show_window)

    # ---- System tray ----
    def _on_quit() -> None:
        """Clean up and exit."""
        try:
            from dragon_translator.llama_manager import stop_local_model
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
    webview.start(debug=os.environ.get("PYWEBVIEW_DEBUG") == "1")

    # ---- Cleanup on exit ----
    if _hotkey_state:
        _hotkey_state.unregister()
    try:
        from dragon_translator.llama_manager import stop_local_model
        stop_local_model()
    except Exception:
        pass
