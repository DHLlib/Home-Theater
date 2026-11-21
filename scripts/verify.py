"""本项目本地质量门；不依赖 CI。

用法：
    python scripts/verify.py                 # 静态检查 + 前端测试
    python scripts/verify.py --static        # 只跑静态检查
    python scripts/verify.py --full          # 再加后端 PostgreSQL 测试与生产构建
    python scripts/verify.py --install-hook  # 安装本仓库的 pre-commit 质量门
"""
from __future__ import annotations

import argparse
import base64
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
HOOK_MARKER = "# home-theater-quality-gate"


def _backend_python() -> Path:
    candidates = [
        BACKEND / ".venv" / "Scripts" / "python.exe",
        BACKEND / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError("未找到 backend/.venv，请先创建虚拟环境并安装开发依赖")


def _npm() -> str:
    executable = shutil.which("npm.cmd") or shutil.which("npm")
    if not executable:
        raise RuntimeError("未找到 npm，请先安装 Node.js")
    if not (FRONTEND / "node_modules").is_dir():
        raise RuntimeError("未找到 frontend/node_modules，请先执行 cd frontend && npm install")
    return executable


def _run(
    label: str,
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    display: str | None = None,
) -> None:
    print(f"\n== {label} ==", flush=True)
    print(display or " ".join(command), flush=True)
    result = subprocess.run(command, cwd=cwd, env=env, check=False)
    if result.returncode:
        raise RuntimeError(f"{label}失败（退出码 {result.returncode}）")


def _powershell_source(paths: list[Path]) -> str:
    literals = ", ".join(
        "'" + str(path).replace("'", "''") + "'" for path in paths
    )
    return f"""
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$paths = @({literals})
$failed = $false
foreach ($path in $paths) {{
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $path, [ref]$tokens, [ref]$errors
    )
    foreach ($error in $errors) {{
        Write-Error "$($path):$($error.Extent.StartLineNumber): $($error.Message)"
        $failed = $true
    }}
}}
if ($failed) {{ exit 1 }}
Write-Output "PowerShell 语法检查通过：$($paths.Count) 个脚本"
"""


def _check_powershell(env: dict[str, str]) -> None:
    paths = sorted(ROOT.glob("*.ps1"))
    if not paths:
        return
    executable = shutil.which("powershell.exe") or shutil.which("pwsh")
    if not executable:
        raise RuntimeError("修改或验收 Windows 启动脚本需要 PowerShell 语法检查")
    source = _powershell_source(paths)
    encoded = base64.b64encode(source.encode("utf-16-le")).decode("ascii")
    _run(
        "PowerShell 语法解析",
        [
            executable,
            "-NoProfile",
            "-NonInteractive",
            "-OutputFormat",
            "Text",
            "-EncodedCommand",
            encoded,
        ],
        ROOT,
        env,
        display=f"PowerShell Parser.ParseFile（{len(paths)} 个脚本）",
    )


def _install_hook() -> None:
    result = subprocess.run(
        ["git", "rev-parse", "--git-path", "hooks"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    hooks = Path(result.stdout.strip())
    if not hooks.is_absolute():
        hooks = ROOT / hooks
    hooks.mkdir(parents=True, exist_ok=True)
    hook = hooks / "pre-commit"
    if hook.exists() and HOOK_MARKER not in hook.read_text(encoding="utf-8"):
        raise RuntimeError(f"已有自定义 pre-commit 钩子，未覆盖：{hook}")
    hook.write_text(
        f"#!/bin/sh\n{HOOK_MARKER}\n"
        "cd \"$(git rev-parse --show-toplevel)\" || exit 1\n"
        "python scripts/verify.py\n",
        encoding="utf-8",
        newline="\n",
    )
    if os.name != "nt":
        hook.chmod(hook.stat().st_mode | 0o111)
    print(f"已安装 pre-commit 质量门：{hook}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Home Theater 本地质量门")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--static", action="store_true", help="只运行静态检查")
    mode.add_argument("--full", action="store_true", help="运行完整本地验收")
    parser.add_argument("--install-hook", action="store_true", help="安装 pre-commit 钩子")
    args = parser.parse_args()
    if args.install_hook and (args.static or args.full):
        parser.error("--install-hook 不能与 --static/--full 同时使用")

    try:
        if args.install_hook:
            _install_hook()
            return 0

        python = _backend_python()
        npm = _npm()
        temp = ROOT / ".tmp" / "temp"
        temp.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(
            {
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
                "PYTHONPYCACHEPREFIX": str(ROOT / ".tmp" / "pycache"),
                "TEMP": str(temp),
                "TMP": str(temp),
            }
        )

        _run(
            "Python 语法编译",
            [str(python), "-m", "compileall", "-q", "app", "scripts", "test"],
            BACKEND,
            env,
        )
        _run(
            "Ruff 未定义名称与导入检查",
            [str(python), "-m", "ruff", "check", "app", "--select", "F"],
            BACKEND,
            env,
        )
        _check_powershell(env)
        _run("前端 TypeScript 类型检查", [npm, "run", "typecheck"], FRONTEND, env)

        if not args.static:
            _run("前端回归测试", [npm, "run", "test"], FRONTEND, env)
        if args.full:
            _run("后端 PostgreSQL 测试", [str(python), "-m", "pytest", "-q"], BACKEND, env)
            _run("前端生产构建", [npm, "run", "build"], FRONTEND, env)

        print("\n质量门通过。", flush=True)
        return 0
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"\n质量门未通过：{exc}", file=sys.stderr, flush=True)
        if "ruff" in str(exc).lower():
            print("请先执行：cd backend && pip install -e \".[dev]\"", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
