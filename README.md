# 式样译

面向服装加工企业的日文试样书翻译审校工作台。当前版本包含可交互网页和真实PDF处理后端，覆盖上传、文字坐标提取、扫描页OCR回退、企业术语匹配、逐块审校、坐标回写PDF及待复核标记。

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
- 保守无损导出：仅替换已确认且能安全放回原坐标的译文
- 未确认内容保留原文，并自动附加“待复核翻译清单”
- 待复核/正式版PDF与交互式HTML导出
- 标准翻译服务请求与响应契约
- 为后续审批状态预留的数据类型

## 本地运行网页

需要Node.js 22.13或更高版本。

```bash
npm install
npm run dev
```

打开开发服务显示的本地地址即可使用。

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

扫描PDF需要Tesseract及日文语言包。`backend/Dockerfile` 已包含日文OCR和Noto CJK字体，可直接作为企业服务器部署基础；本机未安装日文语言包时，扫描页会明确标为“需OCR/待复核”，不会误报处理成功。

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

## 后续升级

建议按以下顺序扩展：

1. 将PDF处理容器部署到企业HTTPS环境
2. 接入正式翻译接口并用现有样本做业务验收
3. 增加任务持久化、文件存储和失败重试
4. 增加用户、角色、分配和审批流程
5. 增加术语版本、审校回流及审计记录

审批状态已经预留为：草稿、处理中、审校中、待审批、已批准、已导出。
