# 式样译

面向服装加工企业的日文试样书翻译审校工作台。当前版本包含可交互网页和真实PDF处理后端，覆盖上传、文字坐标提取、扫描页OCR回退、企业术语匹配、逐块审校、坐标回写PDF及待复核标记。

> 当前为可运行的实验版，已用 DeepSeek、PaddleOCR 和服装日语术语库完成本地样例验证，但导出结果仍需人工审校，不建议直接用于未经复核的生产文件。

## 当前能力

- PDF文件上传与本地任务创建
- 矢量文字坐标提取，扫描页面自动切换日文OCR
- 读取现有XLSX企业术语库，不改写源文件
- 高置信度固定术语直接使用，其余内容进入人工确认
- OpenAI兼容的标准翻译服务适配器，可通过环境变量替换
- 原文坐标标记与中日文对照审校
- 审校页显示真实PDF页面、实际文字坐标框和逐页待确认数量
- 低置信度、术语冲突和待复核状态筛选
- 人工修改、确认、保留原文和术语候选操作
- 原PDF坐标级中文回写，保留页面尺寸、表格和款式图
- 坐标回写导出：已确认译文直接写回原文字位置，并自动缩放字号以适应原框
- 未确认内容保留原文，并自动附加“待复核翻译清单”
- 待复核/正式版PDF与交互式HTML导出
- 标准翻译服务请求与响应契约
- 为后续审批状态预留的数据类型

## 处理流程

1. 上传 PDF，可选上传 XLSX 服装术语库。
2. 优先读取 PDF 文字层；扫描页再使用 Tesseract 或 PaddleOCR。
3. 按坐标拆分日文文字块，调用 DeepSeek 或其他 OpenAI 兼容模型翻译。
4. 保护款号、尺码、数字和单位，并检查译文中是否还有日文残留。
5. 在网页中人工修改和确认，再将中文回写原 PDF 坐标。

## 本地运行网页

需要Node.js 22.13或更高版本。

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动网页和本地 PDF 处理服务；不需要再开两个终端。打开开发服务显示的本地地址即可使用。

网页未配置处理服务时会保持安全演示模式，并禁用文件上传和正式导出，避免把演示数据误认为翻译结果。要启用真实PDF处理，将根目录的 `.env.example` 复制为 `.env.local`，并确认：

```bash
NEXT_PUBLIC_PROCESSING_API_BASE=http://localhost:8000
```

## 本地运行PDF处理服务

服务需要Python 3.9或更高版本。

```bash
python3 -m venv .backend-venv
.backend-venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

在 `backend/.env` 中填写术语库绝对路径，然后加载配置并启动：

```bash
set -a
source backend/.env
set +a
.backend-venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

访问 `http://localhost:8000/health` 可检查翻译适配器和日文OCR是否可用。

扫描PDF可使用Tesseract日文语言包，也可在 macOS 实验环境设置 `OCR_PROVIDER=paddle`，安全复用 RetainPDF 桌面端已保存的 PaddleOCR Token。有文字层的PDF优先直接提取，只有扫描页才会调用远程OCR；OCR结果会标为待复核。

也可以将根目录 `.env.example` 复制为 `.env`，填写 `GLOSSARY_FILE` 后一键启动容器：

```bash
docker compose up --build -d
```

容器会把术语库以只读方式挂载，任务文件保存在 `backend/data/tasks`。网页通过 `NEXT_PUBLIC_PROCESSING_API_BASE` 连接该服务。

## 构建

```bash
npm run build
```

## 翻译接口

网页的 `POST /api/translate` 保留轻量统一契约。真实后端通过 `TRANSLATION_PROVIDER` 切换翻译实现，默认 `glossary-local` 仅做安全的术语替换；设置为 `openai-compatible` 后，可连接企业已有兼容接口或模型服务，而不需要改变审校页面。

```bash
TRANSLATION_PROVIDER=openai-compatible
TRANSLATION_API_BASE=https://your-provider.example/v1
TRANSLATION_API_KEY=replace-me
TRANSLATION_MODEL=your-model
```

正式适配器需要实现以下规则：

- 固定术语优先
- 品牌、款号、色号、尺码和数值保护
- 返回逐文字块置信度
- 返回命中术语和待确认原因

macOS 本机试验可设置 `TRANSLATION_PROVIDER=retain-desktop`，直接复用 RetainPDF 桌面端中的 DeepSeek 地址、模型和密钥。密钥不会复制到项目代码或日志。

## 当前未完善的功能

- PaddleOCR 表格常以整个结构块返回，复杂表格还不能稳定细分到每个单元格回写。
- 中文通常比原日文更长，窄小文本框会缩小字号；极端版式仍可能出现挤压、换行或局部表格线影响。
- 翻译置信度主要来自模型自评和规则检查，尚未经过大规模标注数据校准。
- 术语库支持 XLSX 匹配，但还没有网页端的术语编辑、版本管理、审批和回流学习。
- 任务目前保存在本地文件夹，没有数据库、用户登录、角色权限、协作审批和审计日志。
- 远程 OCR 和模型服务的超时、限流、计费和网络中断仍需更完整的重试与任务恢复机制。
- 目前主要在 macOS 和少量服装式样书上验证，尚未建立 Windows/Linux 及多类 PDF 的系统化回归测试。

## 安全说明

- 不要提交 `.env`、API Key、OCR Token、客户 PDF 或企业术语库。
- 仓库只提供 `.env.example`；所有真实凭据都由用户在本地配置。
- 使用 PaddleOCR 或远程翻译服务时，PDF 内容可能发送给第三方，请先确认数据合规要求。

## 后续升级建议

建议按以下顺序扩展：

1. 将PDF处理容器部署到企业HTTPS环境
2. 接入正式翻译接口并用现有样本做业务验收
3. 增加任务持久化、文件存储和失败重试
4. 增加用户、角色、分配和审批流程
5. 增加术语版本、审校回流及审计记录

审批状态已经预留为：草稿、处理中、审校中、待审批、已批准、已导出。
