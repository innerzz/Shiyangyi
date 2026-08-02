from __future__ import annotations

import html
import json
import os
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import fitz
import httpx

from .retain_config import retain_value


PADDLE_BASE_URL = "https://paddleocr.aistudio-app.com"


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if value:
            self.parts.append(value)


def _plain_text(value: str) -> str:
    if "<" not in value:
        return " ".join(html.unescape(value).split())
    parser = _TextExtractor()
    parser.feed(value)
    return " ".join(parser.parts)


def paddle_token() -> str:
    return retain_value("paddleToken", "PADDLE_API_TOKEN")


def paddle_available() -> bool:
    if os.getenv("OCR_PROVIDER", "").strip().lower() != "paddle":
        return False
    try:
        return bool(paddle_token())
    except RuntimeError:
        return False


def _headers() -> dict[str, str]:
    token = paddle_token()
    if not token:
        raise RuntimeError("PaddleOCR Token 未配置")
    return {"Authorization": f"bearer {token}", "Accept": "application/json"}


def _check(payload: dict[str, Any], stage: str) -> dict[str, Any]:
    if int(payload.get("errorCode", 0) or 0) != 0:
        raise RuntimeError(f"PaddleOCR {stage}失败：{payload.get('errorMsg', '未知错误')}")
    return payload


def recognize_pdf(pdf_path: Path, timeout_seconds: int = 600) -> dict[int, list[dict]]:
    base_url = os.getenv("PADDLE_API_BASE", PADDLE_BASE_URL).strip().rstrip("/")
    model = os.getenv("PADDLE_MODEL", "PP-StructureV3").strip()
    optional = {
        "max_num_input_imgs": 999,
        "useChartRecognition": False,
        "useRegionDetection": True,
        "useDocOrientationClassify": False,
        "useDocUnwarping": False,
        "useTextlineOrientation": False,
        "useSealRecognition": True,
        "useFormulaRecognition": True,
        "useTableRecognition": True,
        "useOcrResultsWithTableCells": True,
        "parseLanguage": "default",
        "visualize": False,
    }
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        with pdf_path.open("rb") as stream:
            response = client.post(
                f"{base_url}/api/v2/ocr/jobs",
                headers=_headers(),
                data={"model": model, "optionalPayload": json.dumps(optional, ensure_ascii=False)},
                files={"file": (pdf_path.name, stream, "application/pdf")},
            )
        response.raise_for_status()
        submitted = _check(response.json(), "提交")
        job_id = str((submitted.get("data") or {}).get("jobId", "")).strip()
        if not job_id:
            raise RuntimeError("PaddleOCR 未返回任务编号")

        deadline = time.monotonic() + timeout_seconds
        json_url = ""
        while time.monotonic() < deadline:
            status_response = client.get(f"{base_url}/api/v2/ocr/jobs/{job_id}", headers=_headers())
            status_response.raise_for_status()
            status = _check(status_response.json(), "查询")
            data = status.get("data") or {}
            state = str(data.get("state", "")).lower()
            if state == "done":
                json_url = str((data.get("resultUrl") or {}).get("jsonUrl", "")).strip()
                break
            if state == "failed":
                raise RuntimeError(f"PaddleOCR 识别失败：{data.get('errorMsg', '未知错误')}")
            time.sleep(3)
        if not json_url:
            raise TimeoutError("PaddleOCR 识别超时")
        result_response = client.get(json_url, timeout=300)
        result_response.raise_for_status()

    pages: list[dict[str, Any]] = []
    for raw_line in result_response.text.splitlines():
        if not raw_line.strip():
            continue
        result = (json.loads(raw_line).get("result") or {})
        pages.extend(result.get("layoutParsingResults") or [])
    return _rows_by_page(pdf_path, pages)


def _rows_by_page(pdf_path: Path, pages: list[dict[str, Any]]) -> dict[int, list[dict]]:
    output: dict[int, list[dict]] = {}
    document = fitz.open(pdf_path)
    try:
        for page_index, payload in enumerate(pages[: len(document)]):
            pruned = payload.get("prunedResult") or {}
            source_width = float(pruned.get("width") or document[page_index].rect.width)
            source_height = float(pruned.get("height") or document[page_index].rect.height)
            x_scale = document[page_index].rect.width / max(source_width, 1)
            y_scale = document[page_index].rect.height / max(source_height, 1)
            rows = []
            for block in pruned.get("parsing_res_list") or []:
                text = _plain_text(str(block.get("block_content", "") or ""))
                bbox = block.get("block_bbox") or []
                if not text or len(bbox) != 4 or not re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", text):
                    continue
                rect = fitz.Rect(
                    float(bbox[0]) * x_scale,
                    float(bbox[1]) * y_scale,
                    float(bbox[2]) * x_scale,
                    float(bbox[3]) * y_scale,
                )
                rows.append({"text": text, "bbox": rect, "font_size": 8.0, "source": "paddle-ocr"})
            output[page_index] = rows
    finally:
        document.close()
    return output

