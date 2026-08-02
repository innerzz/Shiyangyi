"use client";

/* eslint-disable @next/next/no-img-element -- PDF previews are dynamic task assets served by the processing API. */

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type Screen = "dashboard" | "processing" | "review" | "glossary";
type BlockStatus = "confirmed" | "review" | "kept";

type TranslationBlock = {
  id: number;
  backendId?: string;
  marker: string;
  original: string;
  translation: string;
  confidence: number;
  status: BlockStatus;
  glossary: boolean;
  position: string;
  page?: number;
  source?: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

type PdfPage = {
  page: number;
  width: number;
  height: number;
  extraction: string;
  warning?: string;
};

type AnalyzeResponse = {
  task_id: string;
  filename: string;
  provider: string;
  ocr_available: boolean;
  pages: PdfPage[];
  blocks: Array<{
    id: string;
    page: number;
    original: string;
    translation: string;
    confidence: number;
    status: BlockStatus;
    source: string;
    matched_terms: string[];
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
};

const PROCESSING_API_BASE = (process.env.NEXT_PUBLIC_PROCESSING_API_BASE ?? "").replace(/\/$/, "");
const markerPositions = ["mark-a", "mark-b", "mark-c", "mark-d", "mark-e", "mark-f", "mark-g", "mark-h"];
const demoPages: PdfPage[] = [
  { page: 1, width: 841.89, height: 595.28, extraction: "demo" },
  { page: 2, width: 841.89, height: 595.28, extraction: "demo" },
];

const initialBlocks: TranslationBlock[] = [
  { id: 1, marker: "A", original: "生地① CVC裏起毛", translation: "面料① CVC抓绒", confidence: 98, status: "confirmed", glossary: true, position: "mark-a" },
  { id: 2, marker: "B", original: "衿リブ4cm巾両肩で接ぐ", translation: "领口罗纹宽4cm，于两肩处拼接", confidence: 82, status: "review", glossary: false, position: "mark-b" },
  { id: 3, marker: "C", original: "肩接ぎ縫い割り", translation: "肩缝劈缝处理", confidence: 71, status: "review", glossary: false, position: "mark-c" },
  { id: 4, marker: "D", original: "身丈", translation: "衣长", confidence: 99, status: "confirmed", glossary: true, position: "mark-d" },
  { id: 5, marker: "E", original: "袖口巾", translation: "袖口宽", confidence: 99, status: "confirmed", glossary: true, position: "mark-e" },
  { id: 6, marker: "F", original: "後衿中心両端叩き付", translation: "后领中心两端压缝固定", confidence: 79, status: "review", glossary: false, position: "mark-f" },
  { id: 7, marker: "G", original: "ブランドネーム", translation: "主标", confidence: 99, status: "confirmed", glossary: true, position: "mark-g" },
  { id: 8, marker: "H", original: "裾〜12cm", translation: "距下摆12cm", confidence: 97, status: "confirmed", glossary: true, position: "mark-h" },
];

const recentTasks = [
  { name: "LKC73104AV オフショルスウェット", pages: 2, progress: "8 / 12", status: "待复核", time: "今天 15:42" },
  { name: "PLL63328AV 配色ステッチPO", pages: 3, progress: "24 / 24", status: "已完成", time: "昨天 18:10" },
  { name: "PLL63212S 衿レイヤードTEE", pages: 4, progress: "17 / 21", status: "审校中", time: "昨天 16:35" },
];

const glossaryRows = [
  ["縫製指示書", "缝制指示书", "文件 / 表头", "高", "固定"],
  ["身丈", "衣长", "尺寸项目", "高", "固定"],
  ["裄丈", "统袖长", "尺寸项目", "中", "待确认"],
  ["衿ぐり", "领窝", "部位名称", "高", "固定"],
  ["本縫い", "本缝", "缝制工艺", "中", "待确认"],
  ["ラバープリント", "胶浆印花", "印花 / 绣花", "高", "固定"],
  ["ブランドネーム", "主标", "辅料 / 标识", "高", "固定"],
  ["洗濯ネーム", "洗标", "辅料 / 标识", "高", "固定"],
];

export default function Home() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [selectedId, setSelectedId] = useState(2);
  const [filter, setFilter] = useState<"all" | "review" | "confirmed">("review");
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [glossarySearch, setGlossarySearch] = useState("");
  const [taskId, setTaskId] = useState("");
  const [pages, setPages] = useState<PdfPage[]>(demoPages);
  const [activePage, setActivePage] = useState(1);
  const [providerName, setProviderName] = useState("演示数据");
  const [ocrReady, setOcrReady] = useState(false);
  const [processingMode, setProcessingMode] = useState<"demo" | "real">("demo");
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedBlock = blocks.find((block) => block.id === selectedId) ?? blocks[0];
  const pendingCount = blocks.filter((block) => block.status === "review").length;
  const confirmedCount = blocks.filter((block) => block.status !== "review").length;
  const filteredBlocks = blocks.filter((block) => filter === "all" || (filter === "review" ? block.status === "review" : block.status !== "review"));

  const filteredGlossary = useMemo(() => {
    const query = glossarySearch.trim().toLowerCase();
    return glossaryRows.filter((row) => !query || row.some((cell) => cell.toLowerCase().includes(query)));
  }, [glossarySearch]);

  useEffect(() => {
    if (screen !== "processing") return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const limit = processingMode === "real" ? 82 : 100;
        const next = Math.min(current + 2, limit);
        setActiveStep(next < 24 ? 0 : next < 50 ? 1 : next < 76 ? 2 : 3);
        if (next === 100 && processingMode === "demo") {
          window.clearInterval(timer);
          window.setTimeout(() => setScreen("review"), 500);
        }
        return next;
      });
    }, 65);
    return () => window.clearInterval(timer);
  }, [screen, processingMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
      setToast("请上传 PDF 格式的试样书");
      return;
    }
    setFile(nextFile);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  }

  async function startProcessing() {
    if (!file) return;
    setProgress(0);
    setActiveStep(0);
    setTaskId("");
    setPages(demoPages);
    setActivePage(1);
    const realMode = Boolean(PROCESSING_API_BASE);
    setProcessingMode(realMode ? "real" : "demo");
    if (!realMode) {
      setBlocks(initialBlocks);
      setSelectedId(2);
      setScreen("review");
      setToast("当前站点仅演示审校界面，没有读取或翻译你选择的PDF");
      return;
    }
    setScreen("processing");

    const form = new FormData();
    form.append("pdf", file);
    form.append("translate", "true");
    try {
      const response = await fetch(`${PROCESSING_API_BASE}/api/tasks/analyze`, { method: "POST", body: form });
      const payload = await response.json() as AnalyzeResponse | { detail?: string };
      if (!response.ok || !("blocks" in payload)) throw new Error("detail" in payload ? (payload.detail ?? "处理服务返回异常") : "处理服务返回异常");

      const realBlocks: TranslationBlock[] = payload.blocks.map((block, index) => ({
        id: index + 1,
        backendId: block.id,
        marker: String(index + 1),
        original: block.original,
        translation: block.translation,
        confidence: Math.round(block.confidence * 100),
        status: block.status,
        glossary: block.matched_terms.length > 0,
        position: markerPositions[index % markerPositions.length],
        page: block.page,
        source: block.source,
        bbox: block.bbox,
      }));
      payload.pages.filter((page) => page.extraction === "ocr-required").forEach((page) => {
        realBlocks.push({
          id: realBlocks.length + 1,
          marker: `P${page.page}`,
          original: `第 ${page.page} 页为扫描页面`,
          translation: "等待日文 OCR 识别后再翻译",
          confidence: 0,
          status: "review",
          glossary: false,
          position: markerPositions[realBlocks.length % markerPositions.length],
          page: page.page,
          source: "ocr-required",
        });
      });
      setBlocks(realBlocks.length ? realBlocks : initialBlocks);
      setSelectedId(realBlocks.find((block) => block.status === "review")?.id ?? realBlocks[0]?.id ?? 1);
      setTaskId(payload.task_id);
      setPages(payload.pages);
      setActivePage(1);
      setProviderName(payload.provider);
      setOcrReady(payload.ocr_available);
      setProgress(100);
      setActiveStep(3);
      window.setTimeout(() => setScreen("review"), 450);
    } catch (error) {
      setToast(`真实处理服务暂不可用，已切换演示模式：${error instanceof Error ? error.message : "未知错误"}`);
      setProcessingMode("demo");
      setProgress(0);
    }
  }

  function updateTranslation(value: string) {
    setBlocks((current) => current.map((block) => block.id === selectedId ? { ...block, translation: value } : block));
  }

  function selectBlock(id: number) {
    const block = blocks.find((item) => item.id === id);
    setSelectedId(id);
    if (block?.page) setActivePage(block.page);
  }

  function changePage(page: number) {
    setActivePage(page);
    const firstOnPage = blocks.find((block) => (block.page ?? 1) === page && block.status === "review")
      ?? blocks.find((block) => (block.page ?? 1) === page);
    if (firstOnPage) setSelectedId(firstOnPage.id);
  }

  function setBlockStatus(status: BlockStatus) {
    setBlocks((current) => current.map((block) => block.id === selectedId ? { ...block, status } : block));
    setToast(status === "confirmed" ? "该文字块已确认" : "已保留原文");
  }

  function addToGlossary() {
    setBlocks((current) => current.map((block) => block.id === selectedId ? { ...block, glossary: true } : block));
    setToast("已加入术语候选，等待业务确认");
  }

  function downloadReviewHtml() {
    const reviewState = pendingCount > 0 ? "待复核" : "正式版";
    const rows = blocks.map((block) => `<tr><td>${block.marker}</td><td>${escapeHtml(block.original)}</td><td>${escapeHtml(block.translation)}</td><td>${block.status === "review" ? "待确认" : "已确认"}</td></tr>`).join("");
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>试样书审校记录_${reviewState}</title><style>body{font-family:Arial,"PingFang SC",sans-serif;margin:40px;color:#1A2332}header{border-bottom:4px solid #003B7A;padding-bottom:18px;margin-bottom:26px}h1{font-size:26px;margin:0 0 8px}.watermark{position:fixed;right:30px;top:22px;color:#C7000B;font-weight:700;border:2px solid #C7000B;padding:8px 14px;transform:rotate(-4deg)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #D0D5DC;padding:12px;text-align:left}th{background:#F4F6F8;color:#003B7A}button{margin-top:24px;padding:12px 24px;background:#0055A5;color:white;border:0} @media print{button{display:none}}</style></head><body>${pendingCount > 0 ? '<div class="watermark">待复核</div>' : ""}<header><h1>日文试样书审校记录</h1><div>${escapeHtml(file?.name ?? "试样书.pdf")} · ${reviewState} · ${new Date().toLocaleString("zh-CN")}</div><p>本文件仅为文字审校记录，不是保留原版式的翻译PDF。</p></header><table><thead><tr><th>标记</th><th>日文原文</th><th>中文译文</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table><button onclick="window.print()">打印审校记录</button></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(file?.name ?? "试样书").replace(/\.pdf$/i, "")}_审校记录_${reviewState}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    setToast(`${reviewState}审校记录 HTML 已生成`);
  }

  async function downloadTranslatedPdf() {
    if (!taskId) {
      downloadReviewHtml();
      return;
    }
    setExporting(true);
    try {
      const response = await fetch(`${PROCESSING_API_BASE}/api/tasks/${taskId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: blocks.filter((block) => block.backendId).map((block) => ({
            id: block.backendId!,
            translation: block.translation,
            status: block.status,
          })),
        }),
      });
      if (!response.ok) throw new Error("PDF生成失败");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const reviewState = pendingCount > 0 ? "待复核" : "正式版";
      anchor.href = url;
      anchor.download = `${(file?.name ?? "试样书").replace(/\.pdf$/i, "")}_中文版_${reviewState}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setToast(`坐标回写 PDF 已生成，版本：${reviewState}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "PDF生成失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen("dashboard")} aria-label="返回工作台">
          <span className="brand-mark">式</span>
          <span><strong>式样译</strong><small>服装试样书翻译工作台</small></span>
        </button>
        <nav className="topnav" aria-label="顶部导航">
          <button className={screen !== "glossary" ? "active" : ""} onClick={() => setScreen("dashboard")}>任务中心</button>
          <button className={screen === "glossary" ? "active" : ""} onClick={() => setScreen("glossary")}>企业术语库</button>
          <button onClick={() => setToast("审批模块将在管理版中开放")}>审批管理</button>
        </nav>
        <div className="topbar-actions">
          <span className="environment"><i /> {taskId ? "真实处理已连接" : "安全演示环境"}</span>
          <button className="user-button" aria-label="用户菜单">常</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="side-section">
          <span className="side-label">工作区</span>
          <button className={screen === "dashboard" ? "active" : ""} onClick={() => setScreen("dashboard")}><span>▦</span> 工作台</button>
          <button className={screen === "processing" || screen === "review" ? "active" : ""} onClick={() => setScreen("review")}><span>文</span> 翻译任务 <b>3</b></button>
          <button className={screen === "glossary" ? "active" : ""} onClick={() => setScreen("glossary")}><span>译</span> 术语库</button>
          <button onClick={() => setToast("暂无更多导出记录")}><span>⇩</span> 导出记录</button>
        </div>
        <div className="side-section secondary-links">
          <span className="side-label">系统</span>
          <button onClick={() => setToast("翻译接口可在服务器环境变量中配置")}><span>⚙</span> 接口配置</button>
          <button onClick={() => setToast("帮助中心正在完善")}><span>?</span> 使用帮助</button>
        </div>
        <div className="system-card">
          <div><span>系统状态</span><strong>运行正常</strong></div>
          <p><i className={ocrReady ? "success-dot" : "warning-dot"} /> OCR：{ocrReady ? "日文识别已就绪" : "按环境自动回退"}</p>
          <p><i className={taskId ? "success-dot" : "warning-dot"} /> 翻译：{providerName}</p>
        </div>
      </aside>

      <main className="main-content">
        {screen === "dashboard" && (
          <Dashboard
            file={file}
            dragging={dragging}
            fileInput={fileInput}
            setDragging={setDragging}
            onDrop={onDrop}
            onFileChange={onFileChange}
            startProcessing={startProcessing}
            openReview={() => setScreen("review")}
            realProcessingAvailable={Boolean(PROCESSING_API_BASE)}
          />
        )}
        {screen === "processing" && <Processing progress={progress} activeStep={activeStep} fileName={file?.name ?? "试样书.pdf"} />}
        {screen === "review" && (
          <ReviewWorkspace
            fileName={taskId ? (file?.name ?? "试样书.pdf") : "演示任务_未处理原PDF.pdf"}
            blocks={blocks}
            selectedBlock={selectedBlock}
            selectedId={selectedId}
            setSelectedId={selectBlock}
            filter={filter}
            setFilter={setFilter}
            filteredBlocks={filteredBlocks}
            pendingCount={pendingCount}
            confirmedCount={confirmedCount}
            pages={pages}
            activePage={activePage}
            changePage={changePage}
            taskId={taskId}
            processingApiBase={PROCESSING_API_BASE}
            updateTranslation={updateTranslation}
            setBlockStatus={setBlockStatus}
            addToGlossary={addToGlossary}
            openExport={() => setExportOpen(true)}
            providerName={providerName}
          />
        )}
        {screen === "glossary" && <Glossary search={glossarySearch} setSearch={setGlossarySearch} rows={filteredGlossary} />}
      </main>

      {exportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setExportOpen(false)}>
          <section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><span className="eyebrow">导出检查</span><h2 id="export-title">{taskId ? `生成${pendingCount > 0 ? "待复核" : "正式"}版本` : "演示模式不提供正式导出"}</h2></div>
              <button className="icon-button" onClick={() => setExportOpen(false)} aria-label="关闭">×</button>
            </div>
            {pendingCount > 0 ? (
              <div className="alert warning"><strong>还有 {pendingCount} 处内容需要确认</strong><p>系统允许继续导出，文件名和页面中将明确标记“待复核”。</p></div>
            ) : (
              <div className="alert success"><strong>全部文字块均已确认</strong><p>本次可以生成不含待复核标记的正式版本。</p></div>
            )}
            <div className="export-summary">
              <div><span>输出格式</span><strong>{taskId ? "无损回写 PDF" : "演示模式不可导出"}</strong></div>
              <div><span>确认内容</span><strong>{confirmedCount} / {blocks.length}</strong></div>
              <div><span>页面标记</span><strong>{pendingCount > 0 ? "待复核" : "无水印"}</strong></div>
            </div>
            <p className="modal-note">{taskId ? "只替换已确认且能安全放回原坐标的译文；其余内容保留原文并写入待复核附录，避免遮挡图纸、表格或其他原始内容。" : "当前线上站点没有连接真实PDF处理服务。为避免产生误导，本模式不再生成所谓“中文版PDF”。"}</p>
            <div className="modal-actions"><button className="ghost-button" onClick={taskId ? downloadReviewHtml : () => setExportOpen(false)}>{taskId ? "下载审校记录" : "关闭"}</button><button className="primary-button" disabled={exporting || !taskId} onClick={downloadTranslatedPdf}>{exporting ? "正在生成…" : taskId ? "生成无损PDF" : "需连接处理服务"}</button></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Dashboard({ file, dragging, fileInput, setDragging, onDrop, onFileChange, startProcessing, openReview, realProcessingAvailable }: {
  file: File | null;
  dragging: boolean;
  fileInput: React.RefObject<HTMLInputElement | null>;
  setDragging: (value: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  startProcessing: () => void;
  openReview: () => void;
  realProcessingAvailable: boolean;
}) {
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">任务工作台</span><h1>日文试样书翻译</h1><p>上传原始PDF，系统将自动识别、匹配企业术语并生成可审校的中文初稿。</p></div>
        <button className="ghost-button" onClick={openReview}>查看演示任务</button>
      </div>

      <section className="summary-strip" aria-label="系统摘要">
        <div><span className="summary-icon">词</span><p><strong>262</strong><small>企业术语</small></p></div>
        <div><span className="summary-icon">固</span><p><strong>234</strong><small>高置信度固定词</small></p></div>
        <div><span className="summary-icon">审</span><p><strong>26</strong><small>需人工确认术语</small></p></div>
        <div><span className="summary-icon">版</span><p><strong>100%</strong><small>原页尺寸保留</small></p></div>
      </section>

      {!realProcessingAvailable && <section className="demo-mode-warning" role="status"><strong>当前是界面演示，不会读取或翻译你上传的PDF</strong><span>请使用“查看演示任务”体验审校流程。正式上传与无损PDF导出需要先连接企业处理服务。</span></section>}

      <section className="upload-card">
        <div className="section-title"><div><span className="step-number">01</span><div><h2>新建翻译任务</h2><p>{realProcessingAvailable ? "目前支持日文服装试样书PDF，单个文件建议不超过100MB。" : "正式处理服务尚未连接，当前只能查看交互界面。"}</p></div></div><span className="secure-note">{realProcessingAvailable ? "文件仅在当前环境处理" : "演示模式"}</span></div>
        <div className="upload-grid">
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""} ${!realProcessingAvailable ? "demo-disabled" : ""}`}
            onDragOver={(event) => { event.preventDefault(); if (realProcessingAvailable) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { if (realProcessingAvailable) onDrop(event); else event.preventDefault(); }}
            onClick={() => { if (realProcessingAvailable) fileInput.current?.click(); }}
            role="button"
            tabIndex={0}
            aria-disabled={!realProcessingAvailable}
            onKeyDown={(event) => { if (realProcessingAvailable && (event.key === "Enter" || event.key === " ")) fileInput.current?.click(); }}
          >
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" onChange={onFileChange} disabled={!realProcessingAvailable} hidden />
            {!realProcessingAvailable ? <><span className="file-icon">DEMO</span><h3>上传功能暂未开放</h3><p>当前页面不会读取、翻译或保存你的PDF</p><button className="ghost-button" type="button" disabled>等待连接处理服务</button></> : file ? <><span className="file-icon">PDF</span><h3>{file.name}</h3><p>{formatBytes(file.size)} · 已准备上传</p><button className="link-button" type="button">更换文件</button></> : <><span className="upload-icon">⇧</span><h3>拖入日文试样书PDF</h3><p>或点击从电脑中选择文件</p><button className="ghost-button" type="button">选择PDF文件</button></>}
          </div>
          <div className="rules-panel">
            <div className="rules-header"><span>本次使用规则</span><b>企业默认</b></div>
            <ul>
              <li><span>译</span><div><strong>标准翻译接口</strong><small>服务可替换，由服务器环境统一配置</small></div></li>
              <li><span>锁</span><div><strong>高置信度术语自动锁定</strong><small>其余术语进入人工确认列表</small></div></li>
              <li><span>保</span><div><strong>品牌、款号和数值保持原文</strong><small>避免生产数据被误改</small></div></li>
              <li><span>版</span><div><strong>保持原页面结构</strong><small>异常文字块将在审校页标红</small></div></li>
            </ul>
            <button className="primary-button full" disabled={realProcessingAvailable && !file} onClick={startProcessing}>{realProcessingAvailable ? (file ? "开始识别与翻译" : "请先选择PDF文件") : "查看审校界面演示"}</button>
          </div>
        </div>
      </section>

      <section className="tasks-section">
        <div className="section-heading"><div><h2>最近任务</h2><p>继续审校或下载已完成的文件。</p></div><button className="text-button">查看全部任务 →</button></div>
        <div className="table-card">
          <table><thead><tr><th>任务名称</th><th>页数</th><th>审核进度</th><th>状态</th><th>最近更新</th><th /></tr></thead>
            <tbody>{recentTasks.map((task) => <tr key={task.name}><td><strong>{task.name}</strong><small>日文 → 简体中文</small></td><td>{task.pages}页</td><td>{task.progress}</td><td><span className={`status ${task.status === "已完成" ? "success" : task.status === "待复核" ? "warning" : "info"}`}>{task.status}</span></td><td>{task.time}</td><td><button className="row-action" onClick={openReview}>继续处理 →</button></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Processing({ progress, activeStep, fileName }: { progress: number; activeStep: number; fileName: string }) {
  const steps = [
    ["解析PDF页面", "识别页面尺寸、图形和文字坐标"],
    ["日文文字识别", "自动切换文字提取与OCR"],
    ["企业术语匹配", "锁定高置信度标准译法"],
    ["生成中文初稿", "检查数值、代码和版面溢出"],
  ];
  return (
    <section className="processing-page">
      <span className="eyebrow">自动处理</span><h1>正在识别与翻译</h1><p>请保持此页面打开。处理完成后将自动进入人工审校。</p>
      <div className="processing-card">
        <div className="processing-file"><span className="file-icon">PDF</span><div><strong>{fileName}</strong><small>日文试样书 · 企业术语库已加载</small></div><b>{progress}%</b></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        <div className="process-steps">{steps.map((step, index) => <div className={`${index < activeStep ? "done" : index === activeStep ? "current" : ""}`} key={step[0]}><span>{index < activeStep ? "✓" : index + 1}</span><div><strong>{step[0]}</strong><small>{step[1]}</small></div></div>)}</div>
        <div className="processing-note"><i /> 系统只会将需要翻译的文字发送至翻译接口，原始PDF和企业术语库保留在当前环境。</div>
      </div>
    </section>
  );
}

function ReviewWorkspace(props: {
  fileName: string;
  blocks: TranslationBlock[];
  selectedBlock: TranslationBlock;
  selectedId: number;
  setSelectedId: (id: number) => void;
  filter: "all" | "review" | "confirmed";
  setFilter: (filter: "all" | "review" | "confirmed") => void;
  filteredBlocks: TranslationBlock[];
  pendingCount: number;
  confirmedCount: number;
  pages: PdfPage[];
  activePage: number;
  changePage: (page: number) => void;
  taskId: string;
  processingApiBase: string;
  updateTranslation: (value: string) => void;
  setBlockStatus: (status: BlockStatus) => void;
  addToGlossary: () => void;
  openExport: () => void;
  providerName: string;
}) {
  const { fileName, blocks, selectedBlock, selectedId, setSelectedId, filter, setFilter, filteredBlocks, pendingCount, confirmedCount, pages, activePage, changePage, taskId, processingApiBase, updateTranslation, setBlockStatus, addToGlossary, openExport, providerName } = props;
  const currentPage = pages.find((page) => page.page === activePage) ?? pages[0];
  const currentBlocks = blocks.filter((block) => (block.page ?? 1) === activePage);
  const currentFilteredBlocks = filteredBlocks.filter((block) => (block.page ?? 1) === activePage);
  const pagePending = currentBlocks.filter((block) => block.status === "review").length;
  const completion = blocks.length ? Math.round(confirmedCount / blocks.length * 100) : 0;
  const hasRealPreview = Boolean(taskId && processingApiBase && currentPage);
  const previewUrl = (page: number, dpi = 128) => `${processingApiBase}/api/tasks/${taskId}/pages/${page}/preview?dpi=${dpi}`;
  return (
    <div className="review-page">
      <div className="review-heading">
        <div><span className="breadcrumb">翻译任务 / <b>人工审校</b></span><h1>{fileName.replace(/\.pdf$/i, "")}</h1><p>系统已完成初稿，请优先检查标红内容。</p></div>
        <div className="review-actions"><span className="save-state">✓ 所有修改已保存</span><button className="ghost-button">暂存退出</button><button className="primary-button" onClick={openExport}>导出中文版</button></div>
      </div>
      {!taskId ? <div className="review-provider-warning error"><strong>这是固定演示数据，不是你上传PDF的翻译结果</strong><span>当前站点没有读取原文件，也不会提供正式PDF导出。</span></div> : providerName === "glossary-local" && <div className="review-provider-warning"><strong>当前仅启用企业术语替换，没有接入完整句子翻译服务</strong><span>未命中固定术语的内容会保留原文并进入待复核清单。</span></div>}
      <section className="review-summary">
        <div><span>任务状态</span><strong className="warning-text">待复核</strong></div>
        <div><span>页面</span><strong>{activePage} / {pages.length}</strong></div>
        <div><span>文字块</span><strong>{blocks.length}</strong></div>
        <div><span>已确认</span><strong className="success-text">{confirmedCount}</strong></div>
        <div><span>待确认</span><strong className="error-text">{pendingCount}</strong></div>
        <div className="completion"><span>完成度</span><div><i style={{ width: `${completion}%` }} /></div><strong>{completion}%</strong></div>
      </section>

      <section className="review-workbench">
        <div className="page-rail"><span className="rail-label">页面</span>{pages.map((page) => {
          const pending = blocks.filter((block) => (block.page ?? 1) === page.page && block.status === "review").length;
          return <button className={`page-thumb ${page.page === activePage ? "active" : ""}`} key={page.page} onClick={() => changePage(page.page)}>
            {taskId ? <img src={previewUrl(page.page, 72)} alt={`第 ${page.page} 页缩略图`} /> : <div className={`mini-page ${page.page > 1 ? "second" : ""}`}><i /><i />{page.page === 1 && <i />}</div>}
            <b>{page.page}</b><small>{pending ? `${pending}处待确认` : page.extraction === "ocr-required" ? "需OCR" : "已检查"}</small>
          </button>;
        })}</div>
        <div className="document-stage">
          <div className="stage-toolbar"><div><button aria-label="缩小">−</button><span>适合页面</span><button aria-label="放大">＋</button></div><span>第 {activePage} 页 / 共 {pages.length} 页</span><button>原始比例</button></div>
          <div className="document-canvas">
            {hasRealPreview ? <div className="real-pdf-page" style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}` }}>
              <img src={previewUrl(activePage)} alt={`${fileName} 第 ${activePage} 页`} />
              {currentBlocks.filter((block) => block.bbox).map((block) => {
                const bbox = block.bbox!;
                const left = bbox.x0 / currentPage.width * 100;
                const top = bbox.y0 / currentPage.height * 100;
                const width = Math.max((bbox.x1 - bbox.x0) / currentPage.width * 100, 0.8);
                const height = Math.max((bbox.y1 - bbox.y0) / currentPage.height * 100, 1.1);
                return <button
                  key={block.id}
                  className={`pdf-coordinate-marker ${block.status === "review" ? "needs-review" : "confirmed"} ${selectedId === block.id ? "selected" : ""}`}
                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                  onClick={() => setSelectedId(block.id)}
                  title={`${block.original} → ${block.translation}`}
                  aria-label={`定位 ${block.original}`}
                ><span>{block.marker}</span></button>;
              })}
              {currentPage.extraction === "ocr-required" && <div className="page-ocr-notice"><strong>本页需要日文 OCR</strong><span>{currentPage.warning ?? "安装日文OCR语言包后可自动识别"}</span></div>}
            </div> : <div className="spec-page">
              <div className="spec-brand"><strong>縫 製 指 示 書</strong><span>APPAREL SPECIFICATION</span></div>
              <div className="spec-meta"><div>SEASON<br /><b>2026 AW</b></div><div>STYLE<br /><b>オフショルスウェット</b></div><div>LOT NO.<br /><b>LKC73104AV</b></div><div>COUNTRY<br /><b>中国</b></div></div>
              <div className="spec-body"><div className="garment-drawing"><div className="neck" /><div className="sleeve left" /><div className="torso" /><div className="sleeve right" /><div className="rib" /><span className="measure-line vertical">A</span><span className="measure-line horizontal">C</span></div><div className="measure-table">{["身丈", "肩幅", "身幅", "裾巾", "袖丈", "裄丈", "袖巾", "袖口巾", "前下がり"].map((label, index) => <div key={label}><span>{String.fromCharCode(65 + index)}</span><b>{label}</b><em>{[60, "-", 56, 50, "-", 82, 25, "8.5/16", 8][index]}</em></div>)}</div></div>
              <div className="spec-footer"><div><b>生地／材料</b><span>身頃・袖</span><span>衿・袖口・裾</span></div><div><b>ネーム類</b><span>ブランドネーム</span><span>洗濯ネーム</span></div></div>
              {currentBlocks.slice(0, 8).map((block) => <button key={block.id} className={`text-marker ${block.position} ${block.status === "review" ? "needs-review" : "confirmed"} ${selectedId === block.id ? "selected" : ""}`} onClick={() => setSelectedId(block.id)} aria-label={`定位 ${block.original}`}><span>{block.marker}</span><small>{block.translation}</small></button>)}
            </div>}
          </div>
        </div>
        <div className="translation-panel">
          <div className="panel-header"><div><h2>文字块审校</h2><p>正在检查第 {activePage} 页</p></div><span>{pagePending} 待确认</span></div>
          <div className="filter-tabs"><button className={filter === "review" ? "active" : ""} onClick={() => setFilter("review")}>待确认 <b>{pagePending}</b></button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>本页全部</button><button className={filter === "confirmed" ? "active" : ""} onClick={() => setFilter("confirmed")}>已确认</button></div>
          <div className="block-list">{currentFilteredBlocks.length ? currentFilteredBlocks.map((block) => <button key={block.id} className={`${selectedId === block.id ? "selected" : ""} ${block.status}`} onClick={() => setSelectedId(block.id)}><span className="block-marker">{block.marker}</span><div><strong>{block.original}</strong><small>{block.translation}</small></div><em>{block.confidence}%</em></button>) : <div className="empty-blocks">本页没有符合当前筛选条件的文字块</div>}</div>
          <div className="editor-card">
            <div className="editor-meta"><span className={`confidence ${selectedBlock.confidence < 80 ? "low" : ""}`}>识别置信度 {selectedBlock.confidence}%</span>{selectedBlock.glossary && <span className="glossary-hit">已命中术语</span>}</div>
            <label>日文原文<textarea value={selectedBlock.original} readOnly /></label>
            <label>中文译文<textarea value={selectedBlock.translation} onChange={(event) => updateTranslation(event.target.value)} /></label>
            <div className="editor-links"><button onClick={addToGlossary}>＋ 加入术语候选</button><button onClick={() => setBlockStatus("kept")}>保留原文</button></div>
            <button className="confirm-button" onClick={() => setBlockStatus("confirmed")}>✓ 确认当前译文</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Glossary({ search, setSearch, rows }: { search: string; setSearch: (value: string) => void; rows: string[][] }) {
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">企业知识资产</span><h1>服装日语术语库</h1><p>高置信度固定词自动用于翻译，其余术语由业务人员确认。</p></div><button className="primary-button">＋ 新增术语</button></div>
      <section className="summary-strip glossary-summary"><div><span className="summary-icon">全</span><p><strong>262</strong><small>全部术语</small></p></div><div><span className="summary-icon">高</span><p><strong>234</strong><small>高置信度</small></p></div><div><span className="summary-icon">中</span><p><strong>26</strong><small>需要确认</small></p></div><div><span className="summary-icon">类</span><p><strong>12</strong><small>业务类别</small></p></div></section>
      <section className="glossary-card">
        <div className="glossary-toolbar"><label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索日文、中文或类别" /></label><div><button className="ghost-button">导入XLSX</button><button className="ghost-button">导出术语库</button></div></div>
        <table><thead><tr><th>日文原文</th><th>中文标准译法</th><th>类别</th><th>置信度</th><th>规则</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 3 ? <span className={`confidence-tag ${cell === "中" ? "medium" : ""}`}>{cell}</span> : index === 4 ? <span className={`status ${cell === "固定" ? "success" : "warning"}`}>{cell}</span> : cell}</td>)}<td><button className="row-action">编辑</button></td></tr>)}</tbody></table>
      </section>
    </>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character] ?? character));
}
