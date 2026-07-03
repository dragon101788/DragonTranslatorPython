# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Dragon Translator.

Build a portable folder distribution with:
    pyinstaller DragonTranslator.spec

The output will be in dist/DragonTranslator/
"""

import os
from pathlib import Path

# Project root — SPECPATH is the directory containing the spec file
ROOT = Path(SPECPATH).resolve()

a = Analysis(
    [str(ROOT / "src" / "__main__.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Web frontend (Vite build output)
        (str(ROOT / "runtime" / "web"), "web"),
        # Icon for tray
        (str(ROOT / "src" / "icon.ico"), "src"),
        # Runtime configs (dest "." = root of MEIPASS = runtime/)
        (str(ROOT / "runtime" / "default-config.json"), "."),
        (str(ROOT / "runtime" / "llama-config.json"), "."),
        # Base voice models (shipped with app)
        *([(str(ROOT / "runtime" / "piper-voices"), "piper-voices")]
          if (ROOT / "runtime" / "piper-voices").exists() else []),
        # Large binaries (piper, llamafile) copied by 打包.py
    ],
    hiddenimports=[
        "src",
        "src.paths",
        "src.logger",
        "src.user_files",
        "src.single_instance",
        "src.llama_manager",
        "src.tts",
        "src.app",
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
    [],
    [],
    [],
    name="龙腾翻译",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    icon=str(ROOT / "src" / "icon.ico"),
    contents_directory="runtime",  # merge _internal into runtime/
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
