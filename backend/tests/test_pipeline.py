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
            output_text = "\n".join(page.get_text() for page in output_document)
            confirmed_translations = {
                block.translation
                for block in blocks
                if block.status == "confirmed" and block.translation != block.original
            }
            assert confirmed_translations, "样本应至少产生一个可原位回写的固定术语"
            assert any(translation in output_text for translation in confirmed_translations), "固定术语译文应写回PDF"
            for index, source_page in enumerate(source_document):
                output_page = output_document[index]
                assert output_page.rect == source_page.rect, "原页面尺寸必须保持不变"
                assert len(output_page.get_images(full=True)) == len(source_page.get_images(full=True)), "原页面图片必须原样保留"
                source_drawings = len(source_page.get_drawings())
                output_drawings = len(output_page.get_drawings())
                assert output_drawings >= source_drawings * 0.99, "坐标回写不得明显破坏原页面线稿"
    return pages, blocks
