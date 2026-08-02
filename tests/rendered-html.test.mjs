import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function fetchWorker(request) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    request,
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the garment translation workbench", async () => {
  const response = await fetchWorker(new Request("http://localhost/", {
    headers: { accept: "text/html" },
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>式样译｜服装试样书翻译工作台<\/title>/i);
  assert.match(html, /日文试样书翻译/);
  assert.match(html, /企业术语库/);
  assert.match(html, /开始识别与翻译|请先选择PDF文件/);
  assert.match(html, /文件仅在当前环境处理/);
  assert.match(html, /高置信度术语自动锁定/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/i);
});

test("keeps the replaceable translation and real PDF integration points", async () => {
  const [page, contract, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/translation-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/translate/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /NEXT_PUBLIC_PROCESSING_API_BASE/);
  assert.match(page, /\/api\/tasks\/analyze/);
  assert.match(page, /pages\/\$\{page\}\/preview/);
  assert.match(page, /pdf-coordinate-marker/);
  assert.match(page, /\/export/);
  assert.match(page, /待复核/);
  assert.match(contract, /interface TranslationProvider/);
  assert.match(route, /demo-standard-provider/);
});

test("serves the standard translation contract", async () => {
  const response = await fetchWorker(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: "test-task",
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      blocks: [{ id: "b1", text: "身丈", page: 1 }],
      fixedTerms: [{ source: "身丈", target: "衣长" }],
      protectedTerms: [],
    }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.blocks[0].translation, "衣长");
  assert.equal(payload.blocks[0].confidence, 0.99);
});
