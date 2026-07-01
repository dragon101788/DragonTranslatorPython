"""Single-instance enforcement for Windows.

Mirrors the Rust lib.rs ensure_single_instance() and spawn_activate_listener():
uses a named Win32 mutex to detect existing instances, and a named event
to signal the first instance to activate its window.

On non-Windows platforms, always returns True (single instance not enforced).
"""

import sys
import threading
from typing import Callable, Optional

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32

    _CreateMutexW = kernel32.CreateMutexW
    _CreateMutexW.argtypes = [wintypes.LPCVOID, wintypes.BOOL, wintypes.LPCWSTR]
    _CreateMutexW.restype = wintypes.HANDLE

    _CloseHandle = kernel32.CloseHandle
    _CloseHandle.argtypes = [wintypes.HANDLE]
    _CloseHandle.restype = wintypes.BOOL

    _GetLastError = kernel32.GetLastError
    _GetLastError.argtypes = []
    _GetLastError.restype = wintypes.DWORD

    _CreateEventW = kernel32.CreateEventW
    _CreateEventW.argtypes = [wintypes.LPCVOID, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
    _CreateEventW.restype = wintypes.HANDLE

    _SetEvent = kernel32.SetEvent
    _SetEvent.argtypes = [wintypes.HANDLE]
    _SetEvent.restype = wintypes.BOOL

    _ResetEvent = kernel32.ResetEvent
    _ResetEvent.argtypes = [wintypes.HANDLE]
    _ResetEvent.restype = wintypes.BOOL

    _WaitForSingleObject = kernel32.WaitForSingleObject
    _WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    _WaitForSingleObject.restype = wintypes.DWORD

    ERROR_ALREADY_EXISTS = 183
    WAIT_FAILED = 0xFFFFFFFF
    INFINITE = 0xFFFFFFFF
else:
    ERROR_ALREADY_EXISTS = 183  # dummy


MUTEX_NAME = "DragonTec-Translator-SingleInstance"
EVENT_NAME = "DragonTec-Translator-ActivateEvent"


def ensure_single_instance() -> bool:
    """Try to create the single-instance mutex.

    Returns:
        True if this is the first instance (should continue starting).
        False if another instance is already running (should exit).
    """
    if sys.platform != "win32":
        return True

    handle = _CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        return True  # fail safe

    if _GetLastError() == ERROR_ALREADY_EXISTS:
        _CloseHandle(handle)
        # Signal the existing instance to activate itself
        evt = _CreateEventW(None, True, False, EVENT_NAME)
        if evt:
            _SetEvent(evt)
            _CloseHandle(evt)
        return False

    return True


def spawn_activate_listener(on_activate: Callable[[], None]) -> None:
    """Spawn a background thread that listens for activation requests.

    When another instance is launched, it signals a named event.
    This listener waits on that event and calls `on_activate` to
    show/focus the window.

    Args:
        on_activate: Callback to show and focus the app window.
    """
    if sys.platform != "win32":
        return

    def _listener() -> None:
        evt = _CreateEventW(None, True, False, EVENT_NAME)
        if not evt:
            return

        try:
            while True:
                ret = _WaitForSingleObject(evt, INFINITE)
                if ret == WAIT_FAILED:
                    break
                # Activation requested — show/focus window
                try:
                    on_activate()
                except Exception:
                    pass
                _ResetEvent(evt)
        finally:
            _CloseHandle(evt)

    t = threading.Thread(target=_listener, daemon=True, name="single-instance-listener")
    t.start()
