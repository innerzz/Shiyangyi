from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def config_path() -> Path:
    configured = os.getenv("RETAIN_DESKTOP_CONFIG_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "Library/Application Support/retain-pdf-desktop/desktop-config.json"


def load_retain_config() -> dict[str, Any]:
    path = config_path()
    if not path.is_file():
        raise RuntimeError(f"未找到 RetainPDF 桌面配置：{path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("RetainPDF 桌面配置无法读取") from error
    if not isinstance(payload, dict):
        raise RuntimeError("RetainPDF 桌面配置格式不正确")
    return payload


def retain_value(name: str, env_name: str = "") -> str:
    if env_name:
        direct = os.getenv(env_name, "").strip()
        if direct:
            return direct
    value = load_retain_config().get(name, "")
    return str(value or "").strip()

