"""Entry point for Dragon Translator.

Usage:
    python -m dragon_translator          # development
    DragonTranslator.exe                 # after PyInstaller packaging
"""

from dragon_translator.app import run

if __name__ == "__main__":
    run()
