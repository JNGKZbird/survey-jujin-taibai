"""校验 Tauri 构建实际嵌入的 web 资产与 web/ 当前文件一致。

用法（在项目根目录）：
    python tools/verify_embed.py            # 核对 debug 构建
    python tools/verify_embed.py --release  # 核对 release 构建
Tauri 会把静态资产用 brotli 压缩后写进
src-tauri/target/<debug|release>/build/survey-jujin-*/out/tauri-codegen-assets。
本脚本解压每个块，按 SHA-256 与 web/ 对账；任何 web 文件缺失即失败。
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import brotli

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
PROFILE = "release" if "--release" in sys.argv[1:] else "debug"
BUILD = ROOT / "src-tauri" / "target" / PROFILE / "build"


def web_hashes() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in WEB.rglob("*"):
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            out[digest] = path.relative_to(WEB).as_posix()
    return out


def newest_assets_dir() -> Path | None:
    dirs = list(BUILD.glob("survey-jujin-*/out/tauri-codegen-assets"))
    return max(dirs, key=lambda p: p.stat().st_mtime) if dirs else None


def main() -> int:
    assets = newest_assets_dir()
    if assets is None:
        print("找不到 tauri-codegen-assets，请先构建。")
        return 1
    print(f"资产目录：{assets}")
    exe = ROOT / "src-tauri" / "target" / PROFILE / "survey-jujin.exe"
    exe_bytes = exe.read_bytes() if exe.exists() else b""
    if not exe_bytes:
        print(f"警告：找不到 {PROFILE} exe，只核对代码生成目录，不核对最终嵌入。")
    wanted = web_hashes()
    found: set[str] = set()
    missing_in_exe: list[str] = []
    total = 0
    for file in sorted(assets.iterdir()):
        compressed = file.read_bytes()
        try:
            raw = brotli.decompress(compressed)
        except brotli.error:
            continue
        total += 1
        name = wanted.get(hashlib.sha256(raw).hexdigest())
        if name is None:
            stale = "（旧构建残留，未进 exe）" if exe_bytes and compressed not in exe_bytes else ""
            print(f"EXTRA  {file.name}  {len(raw)} 字节 {stale}")
        else:
            found.add(name)
            embedded = not exe_bytes or compressed in exe_bytes
            print(f"MATCH  {name}  {len(raw)} 字节  {'已嵌入 exe' if embedded else '未进 exe'}")
            if not embedded:
                missing_in_exe.append(name)
    missing = sorted(set(wanted.values()) - found)
    print(f"\n压缩块 {total} 个，匹配 {len(found)} 个 web 文件。")
    if missing:
        print("未嵌入：" + "、".join(missing))
        return 1
    if missing_in_exe:
        print("未进 exe：" + "、".join(missing_in_exe))
        return 1
    print("web/ 全部资产都已嵌入 exe。" if exe_bytes else "web/ 全部资产都已生成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
