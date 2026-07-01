# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Dragon Translator.

Build a portable folder distribution with:
    pyinstaller DragonTranslator.spec

The output will be in dist/DragonTranslator/
"""

import os
from pathlib import Path

# Project root
ROOT = Path(__file__).parent.resolve()

a = Analysis(
    [str(ROOT / "dragon_translator" / "__main__.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Web frontend (Vite build output)
        (str(ROOT / "web"), "web"),
        # Runtime resources
        (str(ROOT / "runtime" / "default-config.json"), "runtime"),
        (str(ROOT / "runtime" / "llama-config.json"), "runtime"),
        # Icon for tray
        (str(ROOT / "dragon_translator" / "icon.ico"), "dragon_translator"),
        # Piper TTS engine (if exists)
        *([(str(ROOT / "runtime" / "piper"), "runtime/piper")] if (ROOT / "runtime" / "piper").exists() else []),
        # Piper voices (if any)
        *([(str(ROOT / "runtime" / "piper-voices"), "runtime/piper-voices")] if (ROOT / "runtime" / "piper-voices").exists() else []),
        # Llamafile executable (if exists)
        *([(str(ROOT / "runtime" / "llamafile-vulkan.exe"), "runtime")] if (ROOT / "runtime" / "llamafile-vulkan.exe").exists() else []),
    ],
    hiddenimports=[
        "dragon_translator",
        "dragon_translator.paths",
        "dragon_translator.logger",
        "dragon_translator.user_files",
        "dragon_translator.single_instance",
        "dragon_translator.llama_manager",
        "dragon_translator.tts",
        "dragon_translator.app",
        "webview",
        "webview.platforms.winforms",
        "clr",
        "pythonnet",
        "pystray",
        "pystray._win32",
        "PIL",
        "PIL.Image",
        "win32con",
        "win32gui",
        "win32event",
        "win32api",
        "httpx",
        "pyaudio",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude unused webview backends to reduce size
        "gtk",
        "qt",
        "cocoa",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "gi",
        "tkinter",
        "matplotlib",
        "numpy",
        "pandas",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="龙腾翻译",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window (like .pyw)
    icon=str(ROOT / "dragon_translator" / "icon.ico"),
)

# Create a folder distribution (portable)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="DragonTranslator",
)
