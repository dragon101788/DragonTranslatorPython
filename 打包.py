"""打包脚本 — 构建前端 + PyInstaller 打包"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
FRONTEND_DIR = ROOT / "src" / "frontend"
WEB_DIR = ROOT / "runtime" / "web"
RUNTIME_DIR = ROOT / "runtime"
DIST_DIR = ROOT / "dist"
COLLECT_DIR = ROOT / "dist" / "DragonTranslator"  # PyInstaller intermediate
SPEC_FILE = ROOT / "DragonTranslator.spec"


def step(msg: str) -> None:
    print(f"\n{'=' * 50}")
    print(f"  {msg}")
    print(f"{'=' * 50}")


def run_cmd(args: list[str], cwd: Path) -> None:
    """Run a command via cmd.exe so Node.js/npm are on PATH."""
    cmd = " ".join(args)
    subprocess.run(["cmd", "/c", cmd], cwd=cwd, check=True)


def build_frontend() -> None:
    step("1/3 构建前端")
    if not (FRONTEND_DIR / "node_modules").exists():
        print("  安装 npm 依赖...")
        run_cmd(["npm", "install"], cwd=FRONTEND_DIR)
    print("  vite build...")
    run_cmd(["npx", "vite", "build"], cwd=FRONTEND_DIR)
    print("  前端构建完成 -> runtime/web/")


def run_pyinstaller() -> None:
    step("2/3 PyInstaller 打包")
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", str(SPEC_FILE)],
        cwd=ROOT, check=True,
    )
    print("  PyInstaller 打包完成 -> dist/")


def copy_runtime() -> None:
    step("3/4 复制运行时资源 -> runtime/")
    # All resources go into runtime/ (merged with PyInstaller's contents_directory)
    DIST_RUNTIME = COLLECT_DIR / "runtime"
    DIST_RUNTIME.mkdir(parents=True, exist_ok=True)

    # 配置 (may already be there from PyInstaller datas, overwrite with latest)
    for f in ["default-config.json", "llama-config.json"]:
        src = RUNTIME_DIR / f
        if src.exists():
            shutil.copy2(src, DIST_RUNTIME / f)
            print(f"  {f}")

    # Piper TTS 引擎
    piper_src = RUNTIME_DIR / "piper"
    piper_dst = DIST_RUNTIME / "piper"
    if piper_src.exists():
        if piper_dst.exists():
            shutil.rmtree(piper_dst)
        shutil.copytree(piper_src, piper_dst)
        print(f"  piper/ ({sum(1 for _ in piper_dst.rglob('*'))} files)")

    # Llamafile
    ll_src = RUNTIME_DIR / "llamafile-vulkan.exe"
    if ll_src.exists():
        shutil.copy2(ll_src, DIST_RUNTIME / ll_src.name)
        print(f"  {ll_src.name}")

    # piper-voices（用户可能已下载）
    voices_src = RUNTIME_DIR / "piper-voices"
    voices_dst = DIST_RUNTIME / "piper-voices"
    if any(voices_src.glob("*.onnx")):
        if voices_dst.exists():
            shutil.rmtree(voices_dst)
        shutil.copytree(voices_src, voices_dst)
        count = sum(1 for _ in voices_dst.glob("*.onnx"))
        print(f"  piper-voices/ ({count} voice models)")

    # GGUF 模型（用户可能已下载）
    for gguf in RUNTIME_DIR.glob("*.gguf"):
        shutil.copy2(gguf, DIST_RUNTIME / gguf.name)
        size_mb = gguf.stat().st_size / (1024 * 1024)
        print(f"  {gguf.name} ({size_mb:.1f} MB)")

    print("  资源复制完成")


def flatten_output() -> None:
    step("4/4 展平输出目录")
    # Move everything from dist/DragonTranslator/ to dist/
    for item in COLLECT_DIR.iterdir():
        dst = DIST_DIR / item.name
        if dst.exists():
            if dst.is_dir():
                shutil.rmtree(dst, ignore_errors=True)
            else:
                try:
                    dst.unlink()
                except OSError:
                    pass
        try:
            shutil.move(str(item), str(dst))
        except OSError as e:
            print(f"  警告: 移动 {item.name} 失败: {e}")
    try:
        COLLECT_DIR.rmdir()
    except OSError:
        pass
    # Create empty models/ dir alongside exe (user downloads go here)
    (DIST_DIR / "models").mkdir(exist_ok=True)
    print("  输出 -> dist/")


def _rmtree_force(path: Path, retries: int = 5) -> None:
    """Force-delete a directory tree, retrying on permission errors.

    When a file is locked (antivirus, stale handle), rmtree will fail even
    after taskkill.  In that case we rename the stuck directory to a backup
    name so the new build can proceed — this works because rename on the
    same volume doesn't require the file to be closed.
    """
    import time

    for attempt in range(retries):
        if not path.exists():
            return
        try:
            shutil.rmtree(path)
            return
        except PermissionError:
            if attempt < retries - 1:
                delay = 0.5 * (attempt + 1)
                print(f"  重试清理 {path.name}/ (第{attempt + 1}次, {delay:.1f}s后)...")
                for exe_name in ["龙腾翻译.exe", "llamafile-vulkan.exe"]:
                    subprocess.run(
                        ["taskkill", "/F", "/IM", exe_name],
                        capture_output=True,
                        creationflags=0x08000000,
                    )
                time.sleep(delay)

    # All retries exhausted — rename out of the way
    if path.exists():
        ts = int(time.time())
        backup = path.with_name(f"{path.name}_old_{ts}")
        print(f"  无法删除 {path}/，尝试重命名为 {backup.name}/ ...")
        try:
            shutil.move(str(path), str(backup))
            print(f"  已重命名，稍后可手动删除 {backup}/")
        except OSError:
            print(f"  警告: 重命名也失败，跳过 {path}/，PyInstaller 可能报错")


def clean_dist() -> None:
    """Remove previous dist/ and build/ outputs. Kill locking processes first."""
    import time

    # Kill processes that may hold files in dist/
    for exe_name in ["龙腾翻译.exe", "llamafile-vulkan.exe"]:
        subprocess.run(
            ["taskkill", "/F", "/IM", exe_name],
            capture_output=True,
            creationflags=0x08000000,
        )
    time.sleep(0.5)

    for d in [DIST_DIR, ROOT / "build"]:
        _rmtree_force(d)


def main() -> None:
    print("Dragon Translator 打包脚本")
    clean_dist()
    build_frontend()
    run_pyinstaller()
    copy_runtime()
    flatten_output()
    step("完成")
    print(f"  输出目录: {DIST_DIR}")
    print(f"  可执行文件: {DIST_DIR / '龙腾翻译.exe'}")
    print()
    print("  分发: 把 dist/ 文件夹打包成 zip 即可")


if __name__ == "__main__":
    main()
