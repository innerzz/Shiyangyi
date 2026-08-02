from pathlib import Path
from tempfile import TemporaryDirectory

from app.glossary import Glossary
from app.pdf_service import analyze_pdf, render_page_preview
from app.providers import GlossaryProvider


def run(pdf: Path, glossary_path: Path):
    glossary = Glossary.from_xlsx(glossary_path)
    pages, blocks = analyze_pdf(pdf, glossary, GlossaryProvider())
    assert pages, "PDF应至少包含一页"
    assert blocks, "矢量样本应提取到可审校文字块"
    assert any(block.matched_terms for block in blocks), "样本应至少命中一个术语"
    with TemporaryDirectory() as temporary:
        preview = Path(temporary) / "preview.png"
        render_page_preview(pdf, preview, 1, dpi=72)
        assert preview.is_file() and preview.stat().st_size > 1000, "应生成可用的页面预览图"
    return pages, blocks
