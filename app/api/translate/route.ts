import type { TranslationRequest, TranslationResponse } from "../../../lib/translation-contract";

const demoDictionary: Record<string, string> = {
  "生地① CVC裏起毛": "面料① CVC抓绒",
  "衿リブ4cm巾両肩で接ぐ": "领口罗纹宽4cm，于两肩处拼接",
  "肩接ぎ縫い割り": "肩缝劈缝处理",
  "身丈": "衣长",
  "袖口巾": "袖口宽",
  "後衿中心両端叩き付": "后领中心两端压缝固定",
  "ブランドネーム": "主标",
  "裾〜12cm": "距下摆12cm",
};

export async function POST(request: Request) {
  let payload: TranslationRequest;

  try {
    payload = await request.json() as TranslationRequest;
  } catch {
    return Response.json({ error: "请求内容必须是有效JSON" }, { status: 400 });
  }

  if (!payload.taskId || !Array.isArray(payload.blocks)) {
    return Response.json({ error: "缺少taskId或blocks" }, { status: 400 });
  }

  const response: TranslationResponse = {
    taskId: payload.taskId,
    provider: "demo-standard-provider",
    blocks: payload.blocks.map((block) => {
      const fixedTerm = payload.fixedTerms?.find((term) => term.source === block.text);
      const translated = fixedTerm?.target ?? demoDictionary[block.text] ?? block.text;
      const hasKnownTranslation = Boolean(fixedTerm || demoDictionary[block.text]);

      return {
        id: block.id,
        translation: translated,
        confidence: fixedTerm ? 0.99 : hasKnownTranslation ? 0.82 : 0.5,
        matchedTerms: fixedTerm ? [fixedTerm.source] : [],
        reviewReasons: hasKnownTranslation ? [] : ["演示接口未找到标准译法，需要人工确认"],
      };
    }),
  };

  return Response.json(response);
}
