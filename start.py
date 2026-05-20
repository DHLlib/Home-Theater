#!/usr/bin/env python3
"""Home Theater 一键启动脚本

用法:
    python start.py dev    # 开发模式：前后端同时启动
    python start.py prod   # 生产模式：构建前端 + 启动后端
    python start.py        # 默认 dev 模式
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.resolve()
BACKEND_DIR = PROJECT_ROOT / "backend"
FRONTEND_DIR = PROJECT_ROOT / "frontend"


def run(cmd: list[str], cwd: Path, **kwargs):
    """封装 subprocess.run，自动处理编码。"""
    enc = "gbk" if sys.platform == "win32" else "utf-8"
    return subprocess.run(cmd, cwd=cwd, encoding=enc, errors="ignore", **kwargs)


def check_backend_deps():
    """检查后端依赖是否已安装。"""
    try:
        import fastapi  # noqa: F401
        import sqlalchemy  # noqa: F401
        import httpx  # noqa: F401
        import aiosqlite  # noqa: F401
        return True
    except ImportError:
        return False


def install_backend_deps():
    """安装后端依赖。"""
    print("[HT] 安装后端依赖...")
    result = run(
        [sys.executable, "-m", "pip", "install", "-e", "."],
        cwd=BACKEND_DIR,
    )
    if result.returncode != 0:
        print("[HT] 后端依赖安装失败，请检查 pyproject.toml")
        sys.exit(1)


def check_frontend_deps():
    """检查前端 node_modules 是否存在。"""
    return (FRONTEND_DIR / "node_modules").exists()


def npm_cmd(*args) -> list[str]:
    """返回跨平台的 npm 命令列表。"""
    if sys.platform == "win32":
        return ["cmd", "/c", "npm"] + list(args)
    return ["npm"] + list(args)


def install_frontend_deps():
    """安装前端依赖。"""
    print("[HT] 安装前端依赖...")
    result = run(npm_cmd("install"), cwd=FRONTEND_DIR)
    if result.returncode != 0:
        print("[HT] 前端依赖安装失败")
        sys.exit(1)


def check_port(port: int) -> bool:
    """检查端口是否被占用。"""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def find_pid_on_port(port: int) -> int | None:
    """查找占用端口的进程 PID（Windows）。"""
    try:
        result = run(
            ["netstat", "-ano"],
            cwd=PROJECT_ROOT,
            capture_output=True,
        )
        for line in result.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.strip().split()
                return int(parts[-1])
    except Exception:
        pass
    return None


def kill_pid(pid: int):
    """终止指定 PID 的进程。"""
    run(["taskkill", "/F", "/PID", str(pid)], cwd=PROJECT_ROOT, capture_output=True)


def ensure_port_free(port: int):
    """确保端口空闲，如有占用则提示用户。"""
    if not check_port(port):
        return
    pid = find_pid_on_port(port)
    if pid:
        print(f"[HT] 端口 {port} 被 PID {pid} 占用")
        ans = input(f"[HT] 是否终止 PID {pid} 释放端口？[Y/n] ").strip().lower()
        if ans in ("", "y", "yes"):
            kill_pid(pid)
            time.sleep(1)
            if check_port(port):
                print(f"[HT] 端口 {port} 仍被占用，请手动处理")
                sys.exit(1)
        else:
            print(f"[HT] 端口 {port} 被占用，退出")
            sys.exit(1)
    else:
        print(f"[HT] 端口 {port} 被占用，无法识别进程")
        sys.exit(1)


def mode_dev():
    """开发模式：同时启动前后端。"""
    print("[HT] ===== 开发模式 =====")

    # 依赖检查
    if not check_backend_deps():
        install_backend_deps()
    if not check_frontend_deps():
        install_frontend_deps()

    # 端口检查
    ensure_port_free(8181)
    ensure_port_free(5173)

    # 启动后端
    print("[HT] 启动后端: http://0.0.0.0:8181")
    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "0.0.0.0", "--port", "8181", "--reload"],
        cwd=BACKEND_DIR,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )

    # 启动前端
    print("[HT] 启动前端: http://localhost:5173")
    frontend_proc = subprocess.Popen(
        npm_cmd("run", "dev"),
        cwd=FRONTEND_DIR,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )

    print("[HT] 按 Ctrl+C 停止所有服务")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[HT] 正在停止服务...")
        if sys.platform == "win32":
            backend_proc.send_signal(signal.CTRL_BREAK_EVENT)
            frontend_proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            backend_proc.terminate()
            frontend_proc.terminate()
        backend_proc.wait(timeout=5)
        frontend_proc.wait(timeout=5)
        print("[HT] 已停止")


def mode_prod():
    """生产模式：构建前端 + 启动后端（静态托管）。"""
    print("[HT] ===== 生产模式 =====")

    if not check_backend_deps():
        install_backend_deps()
    if not check_frontend_deps():
        install_frontend_deps()

    ensure_port_free(8181)

    # 构建前端
    print("[HT] 构建前端...")
    result = run(npm_cmd("run", "build"), cwd=FRONTEND_DIR)
    if result.returncode != 0:
        print("[HT] 前端构建失败")
        sys.exit(1)

    # 启动后端
    print("[HT] 启动后端: http://0.0.0.0:8181")
    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "0.0.0.0", "--port", "8181"],
        cwd=BACKEND_DIR,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )

    print("[HT] 按 Ctrl+C 停止")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[HT] 正在停止...")
        if sys.platform == "win32":
            backend_proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            backend_proc.terminate()
        backend_proc.wait(timeout=5)
        print("[HT] 已停止")


def main():
    parser = argparse.ArgumentParser(description="Home Theater 一键启动")
    parser.add_argument(
        "mode",
        nargs="?",
        choices=["dev", "prod"],
        default="dev",
        help="dev=前后端同时启动, prod=构建后单端口启动",
    )
    args = parser.parse_args()

    if args.mode == "dev":
        mode_dev()
    else:
        mode_prod()


if __name__ == "__main__":
    main()
