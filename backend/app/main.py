from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .glossary import Glossary
from .models import AnalyzeResponse, ExportRequest, TranslationBlock
from .pdf_service import analyze_pdf, export_pdf, ocr_available, render_page_preview
from .paddle_ocr import paddle_available
from .providers import provider_from_environment


APP_ROOT = Path(__file__).resolve().parents[1]
TASK_ROOT = Path(os.getenv("TASK_STORAGE_DIR", APP_ROOT / "data" / "tasks")).resolve()
TASK_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="式样译 PDF Processing API", version="0.2.0")
origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8788").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]", "_", Path(name).name)
    return cleaned or "source.pdf"


def _default_glossary() -> Optional[Path]:
    value = os.getenv("DEFAULT_GLOSSARY_PATH", "").strip()
    path = Path(value).expanduser() if value else None
    return path if path and path.is_file() else None


def _load_task(task_id: str):
    if not re.fullmatch(r"[a-f0-9]{16}", task_id):
        raise HTTPException(status_code=404, detail="任务不存在或已清理")
    folder = TASK_ROOT / task_id
    metadata_path = folder / "task.json"
    source_path = folder / "source.pdf"
    if not metadata_path.is_file() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="任务不存在或已清理")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    return folder, source_path, metadata


@app.get("/health")
def health():
    provider = provider_from_environment()
    return {
        "status": "ok",
        "provider": provider.name,
        "ocr_available": ocr_available(),
        "paddle_ocr": paddle_available(),
    }


@app.get("/api/tasks/latest", response_model=AnalyzeResponse)
def latest_task():
    candidates = sorted(
        (path for path in TASK_ROOT.iterdir() if path.is_dir() and (path / "task.json").is_file()),
        key=lambda path: (path / "task.json").stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise HTTPException(status_code=404, detail="暂无可恢复的真实任务")
    payload = json.loads((candidates[0] / "task.json").read_text(encoding="utf-8"))
    return AnalyzeResponse.model_validate(payload)


@app.post("/api/tasks/analyze", response_model=AnalyzeResponse)
def create_task(
    pdf: UploadFile = File(...),
    glossary: Optional[UploadFile] = File(None),
    translate: bool = Form(True),
):
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="请上传PDF文件")

    task_id = uuid.uuid4().hex[:16]
    folder = TASK_ROOT / task_id
    folder.mkdir(parents=True)
    source_path = folder / "source.pdf"
    with source_path.open("wb") as destination:
        shutil.copyfileobj(pdf.file, destination)

    glossary_path = None
    if glossary and glossary.filename:
        if not glossary.filename.lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="术语库必须为XLSX文件")
        glossary_path = folder / "glossary.xlsx"
        with glossary_path.open("wb") as destination:
            shutil.copyfileobj(glossary.file, destination)
    else:
        glossary_path = _default_glossary()

    try:
        termbase = Glossary.from_xlsx(glossary_path) if glossary_path else Glossary.empty()
        provider = provider_from_environment()
        pages, blocks = analyze_pdf(source_path, termbase, provider)
    except Exception as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"文件处理失败：{error}") from error

    if not translate:
        for block in blocks:
            block.translation = block.original
            block.confidence = 0
            block.status = "review"
            block.review_reasons = ["本次未启用自动翻译"]

    if any(page.extraction == "ocr-required" for page in pages):
        # An OCR-required page contains no editable block, but still makes the task pending.
        pending_count = sum(block.status == "review" for block in blocks) + sum(
            page.extraction == "ocr-required" for page in pages
        )
    else:
        pending_count = sum(block.status == "review" for block in blocks)

    response = AnalyzeResponse(
        task_id=task_id,
        filename=_safe_name(pdf.filename),
        provider=provider.name,
        ocr_available=ocr_available(),
        pages=pages,
        blocks=blocks,
        pending_count=pending_count,
        glossary=termbase.summary(),
    )
    metadata = response.model_dump()
    (folder / "task.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return response


@app.get("/api/tasks/{task_id}/pages/{page_number}/preview")
def preview_page(
    task_id: str,
    page_number: int,
    dpi: int = Query(128, ge=72, le=180),
):
    folder, source_path, metadata = _load_task(task_id)
    page_count = len(metadata.get("pages", []))
    if page_number < 1 or page_number > page_count:
        raise HTTPException(status_code=404, detail="页码不存在")
    output_path = folder / f"preview-{page_number}-{dpi}.png"
    if not output_path.is_file():
        try:
            render_page_preview(source_path, output_path, page_number, dpi)
        except Exception as error:
            raise HTTPException(status_code=422, detail=f"页面预览生成失败：{error}") from error
    return FileResponse(
        output_path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.post("/api/tasks/{task_id}/export")
def export_task(task_id: str, request: ExportRequest):
    folder, source_path, metadata = _load_task(task_id)
    original_blocks = [TranslationBlock.model_validate(item) for item in metadata["blocks"]]
    updates = {item.id: item.model_dump() for item in request.blocks}
    unresolved_page = any(page.get("extraction") == "ocr-required" for page in metadata.get("pages", []))
    unresolved_block = any(
        updates.get(block.id, {"status": block.status}).get("status") == "review"
        for block in original_blocks
    )
    pending = unresolved_page or unresolved_block
    source_stem = Path(metadata["filename"]).stem
    suffix = "待复核" if pending else "正式版"
    output_name = f"{source_stem}_中文版_{suffix}.pdf"
    output_path = folder / output_name
    export_pdf(source_path, output_path, original_blocks, updates, force_pending=unresolved_page)
    return FileResponse(output_path, media_type="application/pdf", filename=output_name)
