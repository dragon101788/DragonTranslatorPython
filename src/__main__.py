"""Entry point for Dragon Translator.

Usage:
    python -m src          # development
    DragonTranslator.exe                 # after PyInstaller packaging
"""

from src.app import run

if __name__ == "__main__":
    run()
