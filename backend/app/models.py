from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class TranslationBlock(BaseModel):
    id: str
    page: int
    bbox: BoundingBox
    original: str
    translation: str
    confidence: float = Field(ge=0, le=1)
    status: str
    source: str
    font_size: float = 8
    matched_terms: List[str] = Field(default_factory=list)
    review_reasons: List[str] = Field(default_factory=list)


class PageSummary(BaseModel):
    page: int
    width: float
    height: float
    extraction: str
    block_count: int
    warning: Optional[str] = None


class GlossarySummary(BaseModel):
    total: int = 0
    fixed: int = 0
    review: int = 0
    source: Optional[str] = None


class AnalyzeResponse(BaseModel):
    task_id: str
    filename: str
    provider: str
    ocr_available: bool
    pages: List[PageSummary]
    blocks: List[TranslationBlock]
    pending_count: int
    glossary: GlossarySummary


class ExportBlock(BaseModel):
    id: str
    translation: str
    status: str


class ExportRequest(BaseModel):
    blocks: List[ExportBlock]
