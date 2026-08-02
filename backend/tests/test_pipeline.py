from pathlib import Path

from app.glossary import Glossary
from app.pdf_service import analyze_pdf
from app.providers import GlossaryProvider


def run(pdf: Path, glossary_path: Path):
    glossary = Glossary.from_xlsx(glossary_path)
    pages, blocks = analyze_pdf(pdf, glossary, GlossaryProvider())
    assert pages, "PDF应至少包含一页"
    assert blocks, "矢量样本应提取到可审校文字块"
    assert any(block.matched_terms for block in blocks), "样本应至少命中一个术语"
    return pages, blocks
