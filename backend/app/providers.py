from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Dict, Iterable, List, Protocol

import httpx

from .glossary import Glossary


@dataclass
class ProviderResult:
    translation: str
    confidence: float
    matched_terms: List[str]
    review_reasons: List[str]


class TranslationProvider(Protocol):
    name: str

    def translate(self, texts: Iterable[str], glossary: Glossary) -> List[ProviderResult]:
        ...


class GlossaryProvider:
    """Deterministic local provider used when no external service is configured."""

    name = "glossary-local"

    def translate(self, texts: Iterable[str], glossary: Glossary) -> List[ProviderResult]:
        results = []
        for text in texts:
            exact = glossary.exact(text)
            if exact:
                reasons = [] if exact.fixed else ["术语置信度未达到固定标准，需人工确认"]
                results.append(
                    ProviderResult(
                        translation=exact.target,
                        confidence=0.99 if exact.fixed else 0.78,
                        matched_terms=[exact.source],
                        review_reasons=reasons,
                    )
                )
                continue

            translated = text
            fixed_hits = []
            review_hits = []
            for term in glossary.matches(text):
                if term.source in translated:
                    translated = translated.replace(term.source, term.target)
                else:
                    flexible = r"\s*".join(re.escape(character) for character in term.source)
                    translated, count = re.subn(flexible, term.target, translated, count=1)
                    if not count:
                        continue
                (fixed_hits if term.fixed else review_hits).append(term.source)

            reasons = []
            if review_hits:
                reasons.append("包含尚未固定的企业术语")
            if translated == text:
                reasons.append("未配置正式翻译接口，暂保留原文")
            else:
                reasons.append("仅完成术语替换，完整句子需人工确认")
            confidence = 0.72 if translated != text else 0.45
            results.append(
                ProviderResult(
                    translation=translated,
                    confidence=confidence,
                    matched_terms=fixed_hits + review_hits,
                    review_reasons=reasons,
                )
            )
        return results

    @staticmethod
    def _contains_japanese(text: str) -> bool:
        return bool(re.search(r"[\u3040-\u30ff]", text))


class OpenAICompatibleProvider:
    """Replaceable adapter for any OpenAI-compatible chat-completions endpoint."""

    name = "openai-compatible"

    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 90):
        self.endpoint = base_url.rstrip("/")
        if not self.endpoint.endswith("/chat/completions"):
            self.endpoint += "/chat/completions"
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def translate(self, texts: Iterable[str], glossary: Glossary) -> List[ProviderResult]:
        source_texts = list(texts)
        fixed_terms = [
            {"source": term.source, "target": term.target}
            for term in glossary.terms
            if term.fixed and any(term.source in text for text in source_texts)
        ]
        protected = [self._protected_tokens(text) for text in source_texts]
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是服装生产技术文件翻译员。将日文译为简体中文。"
                        "严格使用固定术语；品牌、款号、色号、尺码、数字和单位原样保留。"
                        "只返回JSON：{\"translations\":[{\"text\":\"...\",\"confidence\":0-1,"
                        "\"review_reasons\":[\"...\"]}]}，条目顺序必须与输入一致。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"fixed_terms": fixed_terms, "protected_tokens": protected, "texts": source_texts},
                        ensure_ascii=False,
                    ),
                },
            ],
        }
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        rows = parsed.get("translations", [])
        if len(rows) != len(source_texts):
            raise ValueError("翻译接口返回条目数量与输入不一致")

        results = []
        for source, row, keep in zip(source_texts, rows, protected):
            translation = str(row.get("text", source)).strip() or source
            missing = [token for token in keep if token not in translation]
            reasons = [str(item) for item in row.get("review_reasons", [])]
            if missing:
                reasons.append(f"需复核受保护内容：{', '.join(missing)}")
            matched = [term.source for term in glossary.matches(source)]
            results.append(
                ProviderResult(
                    translation=translation,
                    confidence=max(0.0, min(float(row.get("confidence", 0.7)), 1.0)),
                    matched_terms=matched,
                    review_reasons=reasons,
                )
            )
        return results

    @staticmethod
    def _protected_tokens(text: str) -> List[str]:
        patterns = [
            r"[A-Z]{2,}[A-Z0-9._/-]*\d+[A-Z0-9._/-]*",
            r"\d+(?:\.\d+)?(?:mm|cm|m|%|号|番)?",
            r"\b(?:XS|S|M|L|LL|XL|XXL)\b",
        ]
        found = []
        for pattern in patterns:
            found.extend(re.findall(pattern, text, flags=re.IGNORECASE))
        return list(dict.fromkeys(found))


def provider_from_environment() -> TranslationProvider:
    provider = os.getenv("TRANSLATION_PROVIDER", "glossary-local").strip().lower()
    if provider in {"openai", "openai-compatible"}:
        base_url = os.getenv("TRANSLATION_API_BASE", "").strip()
        api_key = os.getenv("TRANSLATION_API_KEY", "").strip()
        model = os.getenv("TRANSLATION_MODEL", "").strip()
        if not all([base_url, api_key, model]):
            raise RuntimeError("正式翻译接口缺少 BASE、KEY 或 MODEL 配置")
        return OpenAICompatibleProvider(base_url, api_key, model)
    return GlossaryProvider()
