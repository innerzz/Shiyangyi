from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory

import fitz

from app.glossary import Glossary
from app.pdf_service import analyze_pdf, export_pdf, render_page_preview
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
        output = Path(temporary) / "conservative-export.pdf"
        updates = {
            block.id: {"translation": block.translation, "status": block.status}
            for block in blocks
        }
        export_pdf(pdf, output, blocks, updates)
        with fitz.open(pdf) as source_document, fitz.open(output) as output_document:
            assert len(output_document) >= len(source_document), "导出不得丢失原页面"
            for index, source_page in enumerate(source_document):
                output_page = output_document[index]
                assert output_page.rect == source_page.rect, "原页面尺寸必须保持不变"
                source_words = Counter(word[4] for word in source_page.get_text("words"))
                output_words = Counter(word[4] for word in output_page.get_text("words"))
                assert all(output_words[word] >= count for word, count in source_words.items()), "原页面文字必须完整保留"
                assert len(output_page.get_images(full=True)) == len(source_page.get_images(full=True)), "原页面图片必须原样保留"
                assert len(output_page.get_drawings()) == len(source_page.get_drawings()), "原页面线稿必须原样保留"
    return pages, blocks
