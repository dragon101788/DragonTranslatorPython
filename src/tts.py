"""Text-to-speech via Piper subprocess.

Runs piper.exe as a subprocess, feeds text via stdin,
reads PCM audio from stdout, and plays via PyAudio.

Supports voice discovery, download, delete, and lang-based voice matching.
"""

import json
import os
import struct
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Optional

from src import logger, paths

# ---------------------------------------------------------------------------
# Cancel token for in-progress playback
# ---------------------------------------------------------------------------

_cancel_event: threading.Event | None = None
_cancel_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------


def _piper_exe_path() -> str:
    return str(paths.runtime_dir() / "piper" / "piper.exe")


def voices_dir() -> str:
    """Base voices shipped with the app (runtime/piper-voices/)."""
    return str(paths.runtime_dir() / "piper-voices")


def _voices_dir_models() -> str:
    """User-downloaded voices (models/piper-voices/)."""
    return str(paths.models_dir() / "piper-voices")


# ---------------------------------------------------------------------------
# Lang -> voice mapping
# ---------------------------------------------------------------------------


def _find_voice(lang: str, preferred_voice: Optional[str] = None) -> tuple[str, int]:
    """Find the best voice model for a language.

    Searches both the base voices (runtime/piper-voices/) and
    user-downloaded voices (models/piper-voices/).

    Args:
        lang: Language code (zh, en, ja, ko, etc.) or "auto" / ""
        preferred_voice: Exact voice name (e.g. "zh_CN-huayan-medium"), takes priority

    Returns:
        (model_path, sample_rate) tuple

    Raises:
        FileNotFoundError: If no matching voice is found
    """
    # Search both directories: base (+ models for user-downloaded)
    voice_dirs = [voices_dir(), _voices_dir_models()]
    all_voices = list_voices()

    print(f"[TTS] find_voice: lang={lang} preferred={preferred_voice} dirs={voice_dirs}")

    # If user picked a specific voice, find which dir it's in
    if preferred_voice:
        for vdir in voice_dirs:
            model_path = os.path.join(vdir, f"{preferred_voice}.onnx")
            if os.path.exists(model_path):
                sample_rate = _read_sample_rate(model_path)
                print(f"[TTS] find_voice: preferred -> {model_path} @ {sample_rate}Hz")
                return (model_path, sample_rate)
        # fall through to lang-based search

    # "auto" or empty -> match zh_CN, fallback first available
    if not lang or lang == "auto":
        if not all_voices:
            raise FileNotFoundError("No voices installed. Please download a voice model.")

        zh_voice = next((v for v in all_voices if v["lang"] == "zh_CN"), None)
        target = zh_voice or all_voices[0]
        model_path = _find_on_disk(target["name"], voice_dirs)
        how = "zh_CN match" if zh_voice else "FALLBACK to first voice"
        print(f"[TTS] find_voice: auto -> {target['name']} ({how}) @ {target['sample_rate']}Hz")
        logger.log(
            1, "tts",
            f"find_voice auto: {len(all_voices)} voices, selected=\"{target['name']}\" ({target['lang']}), {target['sample_rate']}Hz"
        )
        if not zh_voice:
            logger.log(
                3, "tts",
                f"WARNING: zh_CN voice not found, fell back to {target['name']} ({target['lang']}). "
                f"Available: {[f'{v['name']}({v['lang']})' for v in all_voices]}"
            )
        return (model_path, target["sample_rate"])

    # Build candidate prefixes for the given lang
    candidates: list[str] = {
        "zh": ["zh_CN", "zh"],
        "en": ["en_US", "en_GB", "en"],
        "ja": ["ja_JP", "ja"],
        "ko": ["ko_KR", "ko"],
        "fr": ["fr_FR", "fr"],
        "de": ["de_DE", "de"],
        "es": ["es_ES", "es"],
        "ru": ["ru_RU", "ru"],
        "pt": ["pt_BR", "pt_PT", "pt"],
        "ar": ["ar_SA", "ar"],
        "th": ["th_TH", "th"],
        "vi": ["vi_VN", "vi"],
    }.get(lang, [lang])

    print(f"[TTS] find_voice: candidates={candidates}")

    for vdir in voice_dirs:
        for prefix in candidates:
            try:
                for entry in os.scandir(vdir):
                    fname = entry.name
                    if fname.startswith(f"{prefix}_") and fname.endswith(".onnx") and not fname.endswith(".onnx.json"):
                        model_path = os.path.join(vdir, fname)
                        sample_rate = _read_sample_rate(model_path)
                        print(f"[TTS] find_voice: found {model_path} @ {sample_rate}Hz")
                        return (model_path, sample_rate)
            except OSError:
                continue

    available = [v["name"] for v in all_voices]
    hint = "piper-voices/ is empty, please download voice models" if not available else f"Available: {available}"
    err = f"No voice found for language '{lang}'. {hint}"
    print(f"[TTS] find_voice: {err}")
    raise FileNotFoundError(err)


def _find_on_disk(name: str, dirs: list[str]) -> str:
    """Find a voice model .onnx file on disk across multiple directories."""
    for vdir in dirs:
        path = os.path.join(vdir, f"{name}.onnx")
        if os.path.exists(path):
            return path
    raise FileNotFoundError(f"Voice not found: {name}.onnx")


def _read_sample_rate(model_path: str) -> int:
    """Read sample_rate from the .onnx.json config file."""
    json_path = f"{model_path}.json"
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"Cannot read {json_path}: {e}")

    return config.get("audio", {}).get("sample_rate", 22050)


# ---------------------------------------------------------------------------
# Voice discovery
# ---------------------------------------------------------------------------


def _scan_voices_dir(vdir: str, voices: list[dict[str, Any]]) -> None:
    """Scan one voice directory and append voice info to the list."""
    try:
        entries = os.scandir(vdir)
    except OSError:
        return

    for entry in entries:
        name = entry.name
        if not name.endswith(".onnx") or name.endswith(".onnx.json"):
            continue

        model_path = os.path.join(vdir, name)
        size_bytes = entry.stat().st_size
        size_mb = round(size_bytes / (1024 * 1024), 1)
        base_name = name[:-5]  # strip .onnx

        json_path = f"{model_path}.json"
        lang = "?"
        quality = "?"
        sample_rate = 22050

        try:
            with open(json_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            lang = config.get("language", {}).get("code", "?")
            quality = config.get("quality", "?")
            sample_rate = config.get("audio", {}).get("sample_rate", 22050)
        except (OSError, json.JSONDecodeError):
            pass

        voices.append({
            "name": base_name,
            "lang": lang,
            "quality": quality,
            "size_mb": size_mb,
            "sample_rate": sample_rate,
        })


def list_voices() -> list[dict[str, Any]]:
    """Scan all piper-voices/ directories and return installed voice metadata."""
    voices: list[dict[str, Any]] = []
    _scan_voices_dir(voices_dir(), voices)           # base voices (shipped)
    _scan_voices_dir(_voices_dir_models(), voices)   # user-downloaded
    voices.sort(key=lambda v: (v["lang"], v["name"]))
    return voices


# ---------------------------------------------------------------------------
# TTS commands
# ---------------------------------------------------------------------------


def tts_speak(
    text: str,
    lang: str,
    voice: Optional[str] = None,
    on_complete: Optional[Callable[[], None]] = None,
) -> None:
    """Start TTS playback in a background thread.

    Args:
        text: Text to speak
        lang: Language code (zh, en, etc.) or "auto"
        voice: Preferred voice name (optional)
        on_complete: Callback when playback finishes (called from bg thread)
    """
    import pyaudio

    print(f"[TTS] ========================================")
    print(f"[TTS] tts_speak START lang={lang} text_len={len(text)}")
    logger.log(1, "tts", f"speak START lang={lang} len={len(text)}")
    preview = text[:50]
    print(f"[TTS] text preview: {preview}")

    if not text.strip():
        print("[TTS] empty text, skipping")
        return

    # 1. Cancel any in-progress playback
    print("[TTS] step1: stopping previous playback...")
    _stop_inner()
    threading.Event().wait(0.05)  # ~50ms

    # 2. Find voice (synchronous validation)
    print(f"[TTS] step2: finding voice for lang={lang}")
    try:
        model_path, sample_rate = _find_voice(lang, voice)
    except (FileNotFoundError, ValueError) as e:
        print(f"[TTS] ERROR: {e}")
        return

    piper_exe = _piper_exe_path()
    print(f"[TTS] step3: piper_exe={piper_exe}")
    print(f"[TTS] step3: model_path={model_path}")

    if not os.path.exists(piper_exe):
        err = f"piper.exe not found: {piper_exe}"
        print(f"[TTS] ERROR: {err}")
        return
    if not os.path.exists(model_path):
        err = f"Voice model not found: {model_path}"
        print(f"[TTS] ERROR: {err}")
        return

    # 3. Set up cancel token
    global _cancel_event
    with _cancel_lock:
        _cancel_event = threading.Event()

    # ---- Spawn background thread for piper generation + audio playback ----
    print("[TTS] step4: spawning background thread for playback...")
    logger.log(1, "tts", "spawning background playback thread")

    cancel = _cancel_event  # capture current cancel event

    def _bg_play() -> None:
        bg = "[TTS-bg]"
        print(f"{bg} thread started")

        # ---- Start piper ----
        try:
            child = subprocess.Popen(
                [piper_exe, "-m", model_path, "--output_raw"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
        except OSError as e:
            print(f"{bg} Failed to start piper: {e}")
            logger.log(3, "tts", f"piper spawn failed: {e}")
            if on_complete:
                on_complete()
            return

        # ---- Write text to stdin ----
        try:
            out, stderr_data = child.communicate(input=text.encode("utf-8"), timeout=30)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate()
            print(f"{bg} piper timed out")
            if on_complete:
                on_complete()
            return
        except Exception as e:
            print(f"{bg} piper communication failed: {e}")
            if on_complete:
                on_complete()
            return

        # ---- Log stderr ----
        if stderr_data:
            stderr_str = stderr_data.decode("utf-8", errors="replace").strip()
            if stderr_str:
                print(f"{bg} piper stderr:\n{stderr_str}")
                logger.write_raw("piper", stderr_str)

        # ---- Check piper exit ----
        if child.returncode != 0:
            print(f"{bg} piper exited with code {child.returncode}")
            if on_complete:
                on_complete()
            return

        all_pcm = out
        print(f"{bg} read {len(all_pcm)} bytes of PCM")

        # ---- Check cancel before playback ----
        if cancel and cancel.is_set():
            print(f"{bg} cancelled before playback")
            if on_complete:
                on_complete()
            return

        # ---- Convert bytes -> i16 samples ----
        if len(all_pcm) < 2:
            print(f"{bg} WARNING: PCM data too short ({len(all_pcm)} bytes), no audio")
            if on_complete:
                on_complete()
            return

        usable = len(all_pcm) - (len(all_pcm) % 2)
        pcm_data = all_pcm[:usable]
        sample_count = usable // 2
        duration_ms = int(sample_count / sample_rate * 1000)
        print(f"{bg} {sample_count} samples, {duration_ms}ms, {sample_rate}Hz mono i16")

        # ---- Audio output via PyAudio ----
        try:
            p = pyaudio.PyAudio()
            stream = p.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=sample_rate,
                output=True,
            )
        except OSError as e:
            print(f"{bg} Failed to open audio device: {e}")
            if on_complete:
                on_complete()
            return

        print(f"{bg} starting playback...")

        # Write in chunks, checking cancel between each
        chunk_size = 4096  # bytes
        try:
            for i in range(0, len(pcm_data), chunk_size):
                if cancel and cancel.is_set():
                    print(f"{bg} playback CANCELLED")
                    break
                chunk = pcm_data[i:i + chunk_size]
                stream.write(chunk)
        except OSError as e:
            print(f"{bg} Audio playback error: {e}")
        finally:
            stream.stop_stream()
            stream.close()
            p.terminate()

        logger.log(1, "tts", f"playback DONE {duration_ms}ms")
        print(f"{bg} playback DONE ({duration_ms}ms duration)")
        print(f"{bg} ========================================")

        # Notify completion
        if on_complete:
            on_complete()

    t = threading.Thread(target=_bg_play, daemon=True, name="tts-playback")
    t.start()

    print("[TTS] background thread spawned, returning immediately")
    print("[TTS] ========================================")


def tts_stop() -> None:
    """Stop any in-progress TTS playback."""
    print("[TTS] tts_stop called")
    _stop_inner()


def open_voices_dir() -> None:
    """Open the user download voices directory in File Explorer."""
    vdir = _voices_dir_models()
    print(f"[TTS] tts_open_voices_dir: {vdir}")
    os.makedirs(vdir, exist_ok=True)
    subprocess.Popen(["explorer", vdir])


def download_voice(url: str, filename: str) -> str:
    """Download a voice model (.onnx) from a URL.

    Args:
        url: Download URL
        filename: Output filename (e.g. "zh_CN-huayan-medium.onnx")

    Returns:
        Status message
    """
    import urllib.request

    vdir = _voices_dir_models()  # user downloads go to models/
    dest = os.path.join(vdir, filename)

    if os.path.exists(dest):
        return f"{filename} already exists"

    print(f"[TTS] download: {url} -> {dest}")

    req = urllib.request.Request(url, headers={"User-Agent": "DragonTranslator/0.7.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()

    os.makedirs(os.path.dirname(dest) or vdir, exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)

    size_mb = len(data) / (1024 * 1024)
    print(f"[TTS] download: saved {filename} ({len(data)} bytes, {size_mb:.1f} MB)")
    return f"Downloaded {filename} ({size_mb:.1f} MB)"


def delete_voice(name: str) -> str:
    """Delete a voice model (both .onnx and .onnx.json files).

    Args:
        name: Voice name without extension (e.g. "zh_CN-huayan-medium")

    Returns:
        Status message

    Raises:
        FileNotFoundError: If the voice doesn't exist
    """
    # Search both base and user directories
    deleted = False
    for vdir in [voices_dir(), _voices_dir_models()]:
        onnx_path = os.path.join(vdir, f"{name}.onnx")
        json_path = os.path.join(vdir, f"{name}.onnx.json")
        if os.path.exists(onnx_path):
            os.remove(onnx_path)
            deleted = True
        if os.path.exists(json_path):
            os.remove(json_path)
            deleted = True

    if deleted:
        print(f"[TTS] deleted voice: {name}")
        return f"Deleted {name}"
    else:
        raise FileNotFoundError(f"Voice not found: {name}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stop_inner() -> None:
    """Set the cancel flag to stop in-progress playback."""
    global _cancel_event
    with _cancel_lock:
        if _cancel_event is not None:
            _cancel_event.set()
            print("[TTS] tts_stop_inner: cancel flag set")
            _cancel_event = None
