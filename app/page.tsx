"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type Screen = "dashboard" | "processing" | "review" | "glossary";
type BlockStatus = "confirmed" | "review" | "kept";

type TranslationBlock = {
  id: number;
  marker: string;
  original: string;
  translation: string;
  confidence: number;
  status: BlockStatus;
  glossary: boolean;
  position: string;
};

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
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedBlock = blocks.find((block) => block.id === selectedId) ?? blocks[0];
  const pendingCount = blocks.filter((block) => block.status === "review").length;
  const confirmedCount = blocks.filter((block) => block.status !== "review").length;
  const filteredBlocks = blocks.filter((block) => filter === "all" || block.status === filter);

  const filteredGlossary = useMemo(() => {
    const query = glossarySearch.trim().toLowerCase();
    return glossaryRows.filter((row) => !query || row.some((cell) => cell.toLowerCase().includes(query)));
  }, [glossarySearch]);

  useEffect(() => {
    if (screen !== "processing") return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + 2, 100);
        setActiveStep(next < 24 ? 0 : next < 50 ? 1 : next < 76 ? 2 : 3);
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => setScreen("review"), 500);
        }
        return next;
      });
    }, 65);
    return () => window.clearInterval(timer);
  }, [screen]);

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

  function startProcessing() {
    if (!file) return;
    setProgress(0);
    setActiveStep(0);
    setScreen("processing");
  }

  function updateTranslation(value: string) {
    setBlocks((current) => current.map((block) => block.id === selectedId ? { ...block, translation: value } : block));
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
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>试样书中文版_${reviewState}</title><style>body{font-family:Arial,"PingFang SC",sans-serif;margin:40px;color:#1A2332}header{border-bottom:4px solid #003B7A;padding-bottom:18px;margin-bottom:26px}h1{font-size:26px;margin:0 0 8px}.watermark{position:fixed;right:30px;top:22px;color:#C7000B;font-weight:700;border:2px solid #C7000B;padding:8px 14px;transform:rotate(-4deg)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #D0D5DC;padding:12px;text-align:left}th{background:#F4F6F8;color:#003B7A}button{margin-top:24px;padding:12px 24px;background:#0055A5;color:white;border:0} @media print{button{display:none}}</style></head><body>${pendingCount > 0 ? '<div class="watermark">待复核</div>' : ""}<header><h1>日文试样书中文审校稿</h1><div>${escapeHtml(file?.name ?? "演示试样书.pdf")} · ${reviewState} · ${new Date().toLocaleString("zh-CN")}</div></header><table><thead><tr><th>标记</th><th>日文原文</th><th>中文译文</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table><button onclick="window.print()">打印或保存为 PDF</button></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(file?.name ?? "试样书").replace(/\.pdf$/i, "")}_中文版_${reviewState}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    setToast(`${reviewState}交互式 HTML 已生成`);
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
          <span className="environment"><i /> 本地演示环境</span>
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
          <p><i className="success-dot" /> OCR 识别模块已就绪</p>
          <p><i className="warning-dot" /> 翻译接口使用演示数据</p>
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
          />
        )}
        {screen === "processing" && <Processing progress={progress} activeStep={activeStep} fileName={file?.name ?? "试样书.pdf"} />}
        {screen === "review" && (
          <ReviewWorkspace
            fileName={file?.name ?? "LKC73104AV_オフショルスウェット.pdf"}
            blocks={blocks}
            selectedBlock={selectedBlock}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            filter={filter}
            setFilter={setFilter}
            filteredBlocks={filteredBlocks}
            pendingCount={pendingCount}
            confirmedCount={confirmedCount}
            updateTranslation={updateTranslation}
            setBlockStatus={setBlockStatus}
            addToGlossary={addToGlossary}
            openExport={() => setExportOpen(true)}
          />
        )}
        {screen === "glossary" && <Glossary search={glossarySearch} setSearch={setGlossarySearch} rows={filteredGlossary} />}
      </main>

      {exportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setExportOpen(false)}>
          <section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><span className="eyebrow">导出检查</span><h2 id="export-title">生成{pendingCount > 0 ? "待复核" : "正式"}版本</h2></div>
              <button className="icon-button" onClick={() => setExportOpen(false)} aria-label="关闭">×</button>
            </div>
            {pendingCount > 0 ? (
              <div className="alert warning"><strong>还有 {pendingCount} 处内容需要确认</strong><p>系统允许继续导出，文件名和页面中将明确标记“待复核”。</p></div>
            ) : (
              <div className="alert success"><strong>全部文字块均已确认</strong><p>本次可以生成不含待复核标记的正式版本。</p></div>
            )}
            <div className="export-summary">
              <div><span>输出格式</span><strong>交互式 HTML</strong></div>
              <div><span>确认内容</span><strong>{confirmedCount} / {blocks.length}</strong></div>
              <div><span>页面标记</span><strong>{pendingCount > 0 ? "待复核" : "无水印"}</strong></div>
            </div>
            <p className="modal-note">导出的 HTML 可直接打开，并通过浏览器“打印”保存为 PDF。正式 PDF 坐标回写将在后端服务接入后复用同一审校数据。</p>
            <div className="modal-actions"><button className="ghost-button" onClick={() => setExportOpen(false)}>返回审校</button><button className="primary-button" onClick={downloadReviewHtml}>确认并导出</button></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Dashboard({ file, dragging, fileInput, setDragging, onDrop, onFileChange, startProcessing, openReview }: {
  file: File | null;
  dragging: boolean;
  fileInput: React.RefObject<HTMLInputElement | null>;
  setDragging: (value: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  startProcessing: () => void;
  openReview: () => void;
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

      <section className="upload-card">
        <div className="section-title"><div><span className="step-number">01</span><div><h2>新建翻译任务</h2><p>目前支持日文服装试样书PDF，单个文件建议不超过100MB。</p></div></div><span className="secure-note">文件仅在当前环境处理</span></div>
        <div className="upload-grid">
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}
          >
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" onChange={onFileChange} hidden />
            {file ? <><span className="file-icon">PDF</span><h3>{file.name}</h3><p>{formatBytes(file.size)} · 已准备上传</p><button className="link-button" type="button">更换文件</button></> : <><span className="upload-icon">⇧</span><h3>拖入日文试样书PDF</h3><p>或点击从电脑中选择文件</p><button className="ghost-button" type="button">选择PDF文件</button></>}
          </div>
          <div className="rules-panel">
            <div className="rules-header"><span>本次使用规则</span><b>企业默认</b></div>
            <ul>
              <li><span>译</span><div><strong>标准翻译接口</strong><small>服务可替换，演示版使用样例数据</small></div></li>
              <li><span>锁</span><div><strong>高置信度术语自动锁定</strong><small>其余术语进入人工确认列表</small></div></li>
              <li><span>保</span><div><strong>品牌、款号和数值保持原文</strong><small>避免生产数据被误改</small></div></li>
              <li><span>版</span><div><strong>保持原页面结构</strong><small>异常文字块将在审校页标红</small></div></li>
            </ul>
            <button className="primary-button full" disabled={!file} onClick={startProcessing}>{file ? "开始识别与翻译" : "请先选择PDF文件"}</button>
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
  updateTranslation: (value: string) => void;
  setBlockStatus: (status: BlockStatus) => void;
  addToGlossary: () => void;
  openExport: () => void;
}) {
  const { fileName, blocks, selectedBlock, selectedId, setSelectedId, filter, setFilter, filteredBlocks, pendingCount, confirmedCount, updateTranslation, setBlockStatus, addToGlossary, openExport } = props;
  return (
    <div className="review-page">
      <div className="review-heading">
        <div><span className="breadcrumb">翻译任务 / <b>人工审校</b></span><h1>{fileName.replace(/\.pdf$/i, "")}</h1><p>系统已完成初稿，请优先检查标红内容。</p></div>
        <div className="review-actions"><span className="save-state">✓ 所有修改已保存</span><button className="ghost-button">暂存退出</button><button className="primary-button" onClick={openExport}>导出中文版</button></div>
      </div>
      <section className="review-summary">
        <div><span>任务状态</span><strong className="warning-text">待复核</strong></div>
        <div><span>页面</span><strong>1 / 2</strong></div>
        <div><span>文字块</span><strong>{blocks.length}</strong></div>
        <div><span>已确认</span><strong className="success-text">{confirmedCount}</strong></div>
        <div><span>待确认</span><strong className="error-text">{pendingCount}</strong></div>
        <div className="completion"><span>完成度</span><div><i style={{ width: `${confirmedCount / blocks.length * 100}%` }} /></div><strong>{Math.round(confirmedCount / blocks.length * 100)}%</strong></div>
      </section>

      <section className="review-workbench">
        <div className="page-rail"><span className="rail-label">页面</span><button className="page-thumb active"><div className="mini-page"><i /><i /><i /></div><b>1</b><small>{pendingCount}处待确认</small></button><button className="page-thumb"><div className="mini-page second"><i /><i /></div><b>2</b><small>已完成</small></button></div>
        <div className="document-stage">
          <div className="stage-toolbar"><div><button>−</button><span>85%</span><button>＋</button></div><span>第 1 页 / 共 2 页</span><button>适合页面</button></div>
          <div className="document-canvas">
            <div className="spec-page">
              <div className="spec-brand"><strong>縫 製 指 示 書</strong><span>APPAREL SPECIFICATION</span></div>
              <div className="spec-meta"><div>SEASON<br /><b>2026 AW</b></div><div>STYLE<br /><b>オフショルスウェット</b></div><div>LOT NO.<br /><b>LKC73104AV</b></div><div>COUNTRY<br /><b>中国</b></div></div>
              <div className="spec-body"><div className="garment-drawing"><div className="neck" /><div className="sleeve left" /><div className="torso" /><div className="sleeve right" /><div className="rib" /><span className="measure-line vertical">A</span><span className="measure-line horizontal">C</span></div><div className="measure-table">{["身丈", "肩幅", "身幅", "裾巾", "袖丈", "裄丈", "袖巾", "袖口巾", "前下がり"].map((label, index) => <div key={label}><span>{String.fromCharCode(65 + index)}</span><b>{label}</b><em>{[60, "-", 56, 50, "-", 82, 25, "8.5/16", 8][index]}</em></div>)}</div></div>
              <div className="spec-footer"><div><b>生地／材料</b><span>身頃・袖</span><span>衿・袖口・裾</span></div><div><b>ネーム類</b><span>ブランドネーム</span><span>洗濯ネーム</span></div></div>
              {blocks.map((block) => <button key={block.id} className={`text-marker ${block.position} ${block.status === "review" ? "needs-review" : "confirmed"} ${selectedId === block.id ? "selected" : ""}`} onClick={() => setSelectedId(block.id)} aria-label={`定位 ${block.original}`}><span>{block.marker}</span><small>{block.translation}</small></button>)}
            </div>
          </div>
        </div>
        <div className="translation-panel">
          <div className="panel-header"><div><h2>文字块审校</h2><p>点击页面标记或下方列表开始编辑</p></div><span>{pendingCount} 待确认</span></div>
          <div className="filter-tabs"><button className={filter === "review" ? "active" : ""} onClick={() => setFilter("review")}>待确认 <b>{pendingCount}</b></button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button><button className={filter === "confirmed" ? "active" : ""} onClick={() => setFilter("confirmed")}>已确认</button></div>
          <div className="block-list">{filteredBlocks.map((block) => <button key={block.id} className={`${selectedId === block.id ? "selected" : ""} ${block.status}`} onClick={() => setSelectedId(block.id)}><span className="block-marker">{block.marker}</span><div><strong>{block.original}</strong><small>{block.translation}</small></div><em>{block.confidence}%</em></button>)}</div>
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
