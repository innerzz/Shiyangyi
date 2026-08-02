from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz

from .glossary import Glossary
from .models import BoundingBox, PageSummary, TranslationBlock
from .providers import TranslationProvider


def ocr_available() -> bool:
    binary = shutil.which("tesseract")
    if not binary:
        return False
    try:
        import subprocess

        result = subprocess.run(
            [binary, "--list-langs"], capture_output=True, text=True, timeout=8, check=False
        )
        languages = set(result.stdout.splitlines())
        return "jpn" in languages or "jpn_vert" in languages
    except Exception:
        return False


def _text_lines(page: fitz.Page) -> List[dict]:
    rows = []
    data = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [span for span in line.get("spans", []) if span.get("text", "").strip()]
            if not spans:
                continue
            text = "".join(span["text"] for span in spans).strip()
            if not text:
                continue
            bbox = fitz.Rect(line["bbox"])
            rows.append(
                {
                    "text": text,
                    "bbox": bbox,
                    "font_size": max(float(span.get("size", 8)) for span in spans),
                    "source": "text",
                }
            )
    return rows


def _ocr_lines(page: fitz.Page) -> List[dict]:
    text_page = page.get_textpage_ocr(language="jpn+eng", dpi=220, full=True)
    data = page.get_text("dict", textpage=text_page)
    rows = []
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [span for span in line.get("spans", []) if span.get("text", "").strip()]
            if not spans:
                continue
            rows.append(
                {
                    "text": "".join(span["text"] for span in spans).strip(),
                    "bbox": fitz.Rect(line["bbox"]),
                    "font_size": max(float(span.get("size", 8)) for span in spans),
                    "source": "ocr",
                }
            )
    return rows


def _is_translatable(text: str, glossary: Glossary) -> bool:
    if len(text.strip()) < 1:
        return False
    if re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", text):
        return True
    return glossary.exact(text) is not None


def analyze_pdf(
    pdf_path: Path, glossary: Glossary, provider: TranslationProvider
) -> Tuple[List[PageSummary], List[TranslationBlock]]:
    document = fitz.open(pdf_path)
    pages = []
    raw_blocks = []
    can_ocr = ocr_available()

    for page_index, page in enumerate(document):
        rows = _text_lines(page)
        extraction = "text"
        warning = None
        if len("".join(row["text"] for row in rows)) < 8:
            if can_ocr:
                try:
                    rows = _ocr_lines(page)
                    extraction = "ocr"
                except Exception as error:
                    rows = []
                    extraction = "ocr-required"
                    warning = f"OCR执行失败：{error}"
            else:
                rows = []
                extraction = "ocr-required"
                warning = "页面为扫描图，当前环境未安装日文OCR语言包"

        page_rows = [row for row in rows if _is_translatable(row["text"], glossary)]
        for row in page_rows:
            raw_blocks.append((page_index, row))
        pages.append(
            PageSummary(
                page=page_index + 1,
                width=round(page.rect.width, 2),
                height=round(page.rect.height, 2),
                extraction=extraction,
                block_count=len(page_rows),
                warning=warning,
            )
        )

    texts = [row["text"] for _, row in raw_blocks]
    translations = provider.translate(texts, glossary) if texts else []
    blocks = []
    for index, ((page_index, row), result) in enumerate(zip(raw_blocks, translations), start=1):
        reasons = list(result.review_reasons)
        status = "confirmed" if result.confidence >= 0.95 and not reasons else "review"
        blocks.append(
            TranslationBlock(
                id=f"b{index}",
                page=page_index + 1,
                bbox=BoundingBox(
                    x0=round(row["bbox"].x0, 2),
                    y0=round(row["bbox"].y0, 2),
                    x1=round(row["bbox"].x1, 2),
                    y1=round(row["bbox"].y1, 2),
                ),
                original=row["text"],
                translation=result.translation,
                confidence=result.confidence,
                status=status,
                source=row["source"],
                font_size=row["font_size"],
                matched_terms=result.matched_terms,
                review_reasons=reasons,
            )
        )
    document.close()
    return pages, blocks


def _font_path() -> Optional[str]:
    configured = os.getenv("PDF_CJK_FONT", "").strip()
    candidates = [
        configured,
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    ]
    return next((path for path in candidates if path and Path(path).exists()), None)


def render_page_preview(
    source_path: Path, output_path: Path, page_number: int, dpi: int = 128
) -> Path:
    document = fitz.open(source_path)
    try:
        if page_number < 1 or page_number > len(document):
            raise ValueError("页码超出PDF范围")
        page = document[page_number - 1]
        scale = dpi / 72
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pixmap.save(output_path)
        return output_path
    finally:
        document.close()


def export_pdf(
    source_path: Path,
    output_path: Path,
    original_blocks: List[TranslationBlock],
    updates: Dict[str, dict],
    force_pending: bool = False,
) -> bool:
    document = fitz.open(source_path)
    pending = force_pending
    font_path = _font_path()
    font = fitz.Font(fontfile=font_path) if font_path else fitz.Font(fontname="china-s")
    replacements = []
    review_items = []

    # Only confirmed translations that safely fit the original text box are
    # replaced. Everything else remains untouched and is listed in an appendix.
    for block in original_blocks:
        update = updates.get(block.id, {})
        translation = str(update.get("translation", block.translation)).strip()
        status = str(update.get("status", block.status))
        if status == "review":
            pending = True
        if not translation or block.source == "ocr-required" or translation == block.original:
            if status == "review":
                review_items.append((block, translation or block.original, "保留原文，待人工确认"))
            continue
        rect = fitz.Rect(block.bbox.x0, block.bbox.y0, block.bbox.x1, block.bbox.y1)
        max_size = min(float(block.font_size), rect.height * 0.78, 11)
        text_width_at_one = max(font.text_length(translation, fontsize=1), 0.1)
        font_size = min(max_size, rect.width * 0.96 / text_width_at_one)
        if status != "confirmed" or font_size < 4.5:
            pending = True
            reason = "译文无法安全写回原坐标" if font_size < 4.5 else "译文尚未人工确认"
            review_items.append((block, translation, reason))
            continue
        replacements.append((block, translation, rect, font_size))

    # Redact text only. Images, table lines and vector drawings are explicitly preserved.
    pages_with_redactions = set()
    for block, _, rect, _ in replacements:
        page = document[block.page - 1]
        page.add_redact_annot(rect, fill=None, cross_out=False)
        pages_with_redactions.add(block.page - 1)
    for page_index in pages_with_redactions:
        document[page_index].apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_NONE,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )

    for block, translation, rect, font_size in replacements:
        page = document[block.page - 1]
        kwargs = {"fontfile": font_path, "fontname": "review-cjk"} if font_path else {"fontname": "china-s"}
        result = page.insert_textbox(
            rect,
            translation,
            fontsize=font_size,
            color=(0.03, 0.12, 0.22),
            align=fitz.TEXT_ALIGN_LEFT,
            overlay=True,
            **kwargs,
        )
        if result < 0:
            # The fit was preflighted; this fallback should be rare. Keep the
            # translated content visible and flag it in the appendix.
            pending = True
            review_items.append((block, translation, "写回后需要检查排版"))

    if review_items:
        _append_review_appendix(document, review_items, font_path)

    if pending:
        for page in document:
            stamp = fitz.Rect(page.rect.width - 92, 10, page.rect.width - 12, 32)
            page.draw_rect(stamp, color=(0.78, 0, 0.04), fill=(1, 0.94, 0.94), width=1, overlay=True)
            kwargs = {"fontfile": font_path, "fontname": "stamp-cjk"} if font_path else {"fontname": "china-s"}
            page.insert_textbox(
                stamp,
                "待复核",
                fontsize=11,
                color=(0.78, 0, 0.04),
                align=fitz.TEXT_ALIGN_CENTER,
                overlay=True,
                **kwargs,
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path, garbage=4, deflate=True)
    document.close()
    return pending


def _append_review_appendix(document: fitz.Document, items: List[tuple], font_path: Optional[str]) -> None:
    page_width, page_height = 841.89, 595.28
    margin = 36
    row_height = 44
    rows_per_page = 10
    kwargs = {"fontfile": font_path, "fontname": "appendix-cjk"} if font_path else {"fontname": "china-s"}

    for offset in range(0, len(items), rows_per_page):
        page = document.new_page(width=page_width, height=page_height)
        page.insert_textbox(
            fitz.Rect(margin, 24, page_width - margin, 52),
            "待复核翻译清单",
            fontsize=17,
            color=(0.0, 0.23, 0.48),
            overlay=True,
            **kwargs,
        )
        page.insert_textbox(
            fitz.Rect(margin, 50, page_width - margin, 70),
            "为避免破坏原式样书，本清单中的内容未覆盖原页面。确认后再执行坐标回写。",
            fontsize=8,
            color=(0.24, 0.31, 0.38),
            overlay=True,
            **kwargs,
        )
        y = 82
        for block, translation, reason in items[offset:offset + rows_per_page]:
            row = fitz.Rect(margin, y, page_width - margin, y + row_height)
            page.draw_rect(row, color=(0.82, 0.84, 0.86), fill=(1, 1, 1), width=0.7)
            page.draw_rect(fitz.Rect(row.x0, row.y0, row.x0 + 62, row.y1), color=None, fill=(0.94, 0.96, 0.98))
            page.insert_textbox(
                fitz.Rect(row.x0 + 6, row.y0 + 5, row.x0 + 58, row.y1 - 4),
                f"第{block.page}页\n{block.id}",
                fontsize=7,
                color=(0.0, 0.23, 0.48),
                overlay=True,
                **kwargs,
            )
            page.insert_textbox(
                fitz.Rect(row.x0 + 68, row.y0 + 4, row.x0 + 350, row.y1 - 4),
                f"原文：{block.original}",
                fontsize=7,
                color=(0.1, 0.14, 0.2),
                overlay=True,
                **kwargs,
            )
            page.insert_textbox(
                fitz.Rect(row.x0 + 356, row.y0 + 4, row.x1 - 8, row.y1 - 4),
                f"译文：{translation}\n原因：{reason}",
                fontsize=7,
                color=(0.1, 0.14, 0.2),
                overlay=True,
                **kwargs,
            )
            y += row_height
