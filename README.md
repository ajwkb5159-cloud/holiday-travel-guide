# 节假日旅游攻略系统（Holiday Travel Guide）

一个可自托管的节假日旅游攻略站点：Vue 2.7 前端 + ASP.NET Core 10 API + SQLite(WAL) 存储 + 月度数据投料 Worker。内置 AI 行程助手（SSE 流式 + RAG 站内引用）、个性化推荐、原子月度数据切换、更新窗口遮罩与数据新鲜度提示。

> English summary: A self-hosted holiday travel guide with a Vue 2.7 SPA, an ASP.NET Core 10 API, SQLite WAL storage, monthly atomic data ingestion, an SSE AI trip assistant with RAG citations, and personalized recommendations.

## 功能特性

- **攻略站**：首页、攻略列表/详情、目的地、节假日、标签云、搜索（FTS5 + LIKE 降级）、收藏（localStorage）。
- **AI 行程助手**：全局悬浮窗，基于站内攻略做 RAG，SSE 流式输出，回答带可点击的攻略引用卡；按 IP + 全局双额度限流。
- **个性化推荐**：「猜你喜欢」读取本地行为信号（浏览/收藏），后端按目的地/分类/标签/季节/热度打分。
- **月度数据原子切换**：`begin → batch → complete` 单事务发布，更新期间读接口返回 503「服务器繁忙」，前端全屏遮罩并在恢复后自动刷新。
- **数据新鲜度**：`/api/system/status` 公开返回 `LastMonthKey` / `LastPublishTime` / `GuideCount` / `DataAgeDays` / `IsStale`，页脚展示更新时间，过期时追加提示。
- **本地图片**：12 城市 × 10 张景点图 + 10 节日封面全部自托管于 `wwwroot/images/`，同一城市不同攻略使用不同景点图，不依赖外部图床。
- **Windows 服务化**：后端、Updater 均可注册为 Windows 服务；提供部署、服务安装、月度计划任务、Token 轮换脚本。

## 架构

```text
data/{yyyyMM}/guides.json
        │
        ▼
HolidayGuideUpdater（Worker Service / --run-once）
  begin → batch → complete（原子切换，旧数据在新数据发布后删除）
        │  HTTP + X-Update-Token
        ▼
HolidayGuideBackend（ASP.NET Core 10，默认 :5099）
  /api/* 只读 + /api/update/* 鉴权 + /api/ai/* SSE
  SQLite WAL + FTS5 + 进程内 L1 缓存
        │  静态文件 + SPA history fallback
        ▼
holiday-travel-guide-web（Vue 2.7 + Element UI + Vite 5）
  build 产物写入 HolidayGuideBackend/wwwroot
```

| 组件 | 技术 | 职责 |
|------|------|------|
| `HolidayGuideBackend` | ASP.NET Core 10 + SqlSugar + SQLite(WAL) | API、鉴权、服务门、AI 助手、静态页托管 |
| `HolidayGuideUpdater` | .NET Worker Service | 读取月度 JSON，batch 投料，原子发布，断点续传 |
| `holiday-travel-guide-web` | Vue 2.7 + Element UI + Vite 5 | 前端 SPA |
| `scripts/` | Node / Batch / PowerShell | 数据生成、月度任务、部署、测试 |

## 目录

```text
.
├── HolidayGuideBackend/          # ASP.NET Core API + wwwroot（构建产物）
├── HolidayGuideUpdater/          # 月度投料 Worker
├── holiday-travel-guide-web/     # Vue 前端源码（public/images 为本地封面）
├── scripts/                      # 数据生成 / 月度任务 / 部署 / 测试
├── samples/202601/guides.json    # 脱敏示例数据（12 城市 + 10 节日）
├── docs/                         # 架构、部署、数据管线、测试、安全
├── HolidayGuideSystem.slnx
└── README.md
```

## 快速开始

### 环境

- .NET SDK **10**
- Node.js **20+**（使用 `playwright-core` 测试时要求 ≥20）
- Windows 10/11 推荐用于服务/批处理脚本；核心 .NET 项目本身跨平台

### 构建

```bash
# 后端 + Updater
dotnet build HolidayGuideSystem.slnx

# 前端：安装依赖并构建到后端 wwwroot
cd holiday-travel-guide-web
npm install
npm run build
cd ..
```

### 配置（两处 token 必须一致）

1. 生成一个 64 位 hex token：

```bash
openssl rand -hex 32
# 或 PowerShell:
# $b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString('x2') }) -join ''
```

2. 写入 `HolidayGuideBackend/appsettings.json` 的 `Update:Token`。
3. 写入 `HolidayGuideUpdater/appsettings.json` 的 `Backend:UpdateToken`，并把 `Backend:BaseUrl` 指向后端地址。
4. 不要把真实 token 提交到仓库；仓库内默认是 `dev-only-token-change-me`。

AI 助手默认关闭。需要时设置：

```json
"Ai": {
  "Enabled": true,
  "BaseURL": "https://opencode.ai/zen/go/v1/chat/completions",
  "Model": "deepseek-v4.1-flash",
  "ApiKey": "",
  "ApiKeyFile": "F:\\HolidayGuide\\secrets\\opencode.key",
  "MaxTokens": 3000,
  "TimeoutSeconds": 120,
  "SendReasoningContent": false,
  "QuotaEnabled": false,
  "HistoryMaxTurns": 500,
  "HistoryMaxChars": 1500000,
  "HistoryPerMessageChars": 50000
}
```

- `BaseURL` 必须是完整的 `.../chat/completions` 端点，代码不会自动追加 `/v1`。
- 生产推荐 `ApiKeyFile` 绝对路径（SYSTEM 服务的 `~` 指向 systemprofile）；文件放在 publish 之外并限制 ACL。
- Key 解析链：`ApiKey` → `ApiKeyFile` → `OPENCODE_API_KEY_FILE` / `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`；不再保留 DashScope 回退。
- `QuotaEnabled=false`（默认）= 不限每日次数，前端不显示额度角标；`HistoryMaxTurns/Chars` 控制多轮历史，默认允许约 1M tokens 上下文。
- DeepSeek 系模型若要求多轮历史带 `reasoning_content`，把 `SendReasoningContent` 设为 `true`；先用 `node scripts/probe-ai-provider.mjs` 探测。
- 任何兼容 OpenAI 流式协议的服务都可以通过 `BaseURL` / `Model` 替换。

### 运行

```bash
# 后端（避免 launchSettings 覆盖端口时可加 --no-launch-profile）
dotnet run --project HolidayGuideBackend --no-launch-profile

# 另开终端：加载示例数据（12 城市各 1 篇 + 10 节日）
mkdir -p HolidayGuideUpdater/data/202601
cp samples/202601/guides.json HolidayGuideUpdater/data/202601/guides.json
dotnet run --project HolidayGuideUpdater -- --run-once --month 202601
```

打开 `http://127.0.0.1:5099`。示例数据的封面是本地 `/images/...` 路径，构建前端后即可显示。

## 数据契约

`data/{yyyyMM}/guides.json`：

```json
{
  "guides": [{
    "externalId": "beijing-zhongqiu",
    "title": "北京中秋故宫深度游",
    "summary": "……",
    "content": "<h2>……</h2><p>……</p>",
    "coverImage": "/images/destinations/beijing-02.jpg",
    "destination": "北京",
    "region": "北京",
    "season": "autumn",
    "holidayName": "中秋节",
    "holidayDate": "2026-09-25",
    "days": 3,
    "category": "人文",
    "tags": ["故宫", "中秋", "文化"]
  }],
  "holidays": [{
    "name": "中秋节",
    "date": "2026-09-25",
    "type": "traditional",
    "isLegal": 1,
    "description": "赏月吃月饼，阖家团圆",
    "coverImage": "/images/holidays/zhongqiu.jpg"
  }]
}
```

- `content` 是 HTML，由前端 DOMPurify 清洗后渲染；生成器应只输出安全标签。
- `externalId` 全局唯一（≤64 字符）。
- `holidays` 只在批次 0 发一次；Updater 已处理该约束。
- 示例数据在 `samples/202601/guides.json`，不参与自动投料。

## AI 助手与推荐

- `POST /api/ai/chat`：SSE 事件 `delta` / `sources` / `done` / `error`。检索复用 `ISearchService.RetrieveForRagAsync`，答案中的 `[n]` 映射回攻略引用。
- 额度：默认 `Ai:QuotaEnabled=false`，不限每日次数、前端无额度角标；需要时可开启并设置 `DailyIpQuota`/`GlobalDailyCap`（SQLite `AiQuota` 计数）。
- 上下文：默认 `HistoryMaxTurns=500` / `HistoryMaxChars=1,500,000` / 单条 `50,000`，前端最多带 500 条历史，后端按总字符预算裁剪，支持模型 1M token 上下文。
- 反向代理（如 cpolar/Nginx）后必须解析 `X-Forwarded-For` 首段，否则所有访客会被当成同一个 IP。
- `GET /api/guide/recommend?destinations=&categories=&tags=&excludeIds=&limit=`：纯读打分接口；行为信号存 localStorage，无后端写接口。
- `Ai:Enabled=false` 时 chat 返回 501，前端悬浮球不渲染。

## 月度数据生产

`scripts/gen-real.mjs` 为 120 篇攻略生成器（12 目的地 × 10 节日），支持：

```bash
node scripts/gen-real.mjs --month 202610 --provider opencode --fallback-provider zhipu
node scripts/gen-real.mjs --month 202610 --smoke beijing-zhongqiu --provider opencode --no-fallback
node scripts/gen-real.mjs --month 202610 --validate-only
node scripts/gen-real.mjs --probe-keys --require-primary --key-dir /path/to/keys
node scripts/gen-real.mjs --month 202610 --fresh --allow-reuse 0   # 全量重生成，禁止旧内容兜底
```

- **节日日期动态计算**：`scripts/lib/holidays.mjs` 用 `lunar-javascript` 按目标月份滚动 12 个月窗口，农历/节气/固定日期都算，闰月不参与；`scripts/test-holidays.mjs` 锁定 202610 与跨年/闰月边界。
- **公开事实层**：`scripts/refresh-facts.mjs` 以中文 Wikivoyage（旅行向内容）为主源，抓取城市/景点摘要，并读取官方节假日安排（`timor.tech`，可失败），写入 `data/{yyyyMM}/facts.json`；生成器把事实块注入 prompt，票价/营业时间等易变信息要求写区间并注明「以景区公告为准」。中文 Wikipedia 在部分国内网络不可达，不作为必需源。
- 主通道：OpenCode Go `deepseek-v4.1-flash`（`F:\HolidayGuide\secrets\opencode.key`，支持 `response_format:json_object`）→ 备 智谱 GLM-4-Flash / 硅基流动免费层。**DashScope/qwen-flash 已移除**。
- Key 解析链：`--api-key` → `--key-file` → provider key 文件（OpenCode 用绝对路径）→ `--key-dir` / `HOLIDAY_GUIDE_KEY_DIR` 下的 `.zhipu.key` / `.siliconflow.key` → `OPENCODE_*` 环境变量 → 本机 MCP 配置。
- Windows 计划任务以 SYSTEM 运行时，`homedir()` 指向 systemprofile；**必须**用 `--key-dir` 或 `HOLIDAY_GUIDE_KEY_DIR` 指向真实用户目录（`run-monthly-data.bat` 已通过本地配置处理）。
- 单篇正文分 2 段生成，规避小模型输出上限截断；失败篇目仅在节日日期/天数/季节仍匹配时才复用上月内容，避免旧内容复活。
- 封面 URL 带 `?v=yyyyMM`，月度换图后浏览器不会继续吃旧缓存。

自动化脚本：

```bat
:: 安装脚本侧依赖（农历）
npm ci --prefix scripts

:: 复制配置模板并填写 KEYDIR / PUBDIR / provider / PUBLISH_WWWROOT
copy scripts\monthly-data.local.bat.example scripts\monthly-data.local.bat

:: 先做无 LLM 的环境/key/路径预检
scripts\run-monthly-data.bat --probe

:: 手动跑一次（--fresh 会先把旧 partial 移到 partial.bak-*）
scripts\run-monthly-data.bat --fresh --force

:: 注册计划任务（需管理员），再用提权脚本核验
scripts\install-monthly-task.bat
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-schedule.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-monthly-task-elevated.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-monthly-task-run.ps1

:: 同月安全重发（停服备份 → --run-once → 校验 120/10）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-month-elevated.ps1 -Month 202610
```

## 更新窗口与数据新鲜度

- `Update:BusyDuringUpdate` / `Update:BusyWhenEmpty` 控制更新/空库时读接口是否 503。
- `Update:StaleThresholdDays`（默认 40）控制 `IsStale` 阈值；页脚在过期时显示「数据可能已过期」。
- `GET /api/system/status` 公开，返回当前模式、上次发布月份/时间、攻略/节日数量、数据年龄。
- 更新会话：`begin` 写入 `UpdateJob` 并置 `IsUpdating=true`，`batch` 插入未发布数据，`complete` 单事务删除旧数据并发布新数据；`abort` 清理本批未发布数据。

## 部署

```bash
# 1) 前端构建
cd holiday-travel-guide-web && npm run build && cd ..

# 2) 发布后端 + Updater
dotnet publish HolidayGuideBackend -c Release -o <stage>/backend
dotnet publish HolidayGuideUpdater -c Release -o <stage>/updater

# 3) 管理员 PowerShell 部署（保护生产 appsettings / Data / data / logs / state.json）
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\deploy-prod-elevated.ps1 `
  -Stage <stage> -PublishRoot <publish-root> -BackupRoot <backup-root>
```

- 部署脚本会停服务 → 备份 SQLite 三件套 → 镜像二进制（排除 `appsettings.json`、`Data`、`data`、`logs`、`state.json`）→ 校验生产 `Ai.ApiKey` → 重启 → 查询 status。
- 只更新 Updater 时加 `-SkipBackend`，后端不重启。
- 服务安装：`scripts/install-updater-service.bat [exe path]`；卸载：`scripts/uninstall-updater-service.bat`。
- 更新 Token：`scripts/rotate-update-token.ps1 -PublishRoot <publish-root> -BackupRoot <backup-root>`（提权；不打印 token；失败自动回滚）。
- 注意：改 `appsettings.json` 不会热重载，必须重启对应服务；`wwwroot` 静态文件可热更新。

## 测试

测试一律使用**全新端口 + 生产库快照**，不要把 `begin/abort` 测试打到生产：

```bash
# 37 项 UI/API 回归
node scripts/e2e-verify-v2.mjs --base http://127.0.0.1:5201

# 13 项数据新鲜度 / 503 遮罩 / 自动刷新
node scripts/verify-upgrade.mjs --base http://127.0.0.1:5201 --token <test-token> --month 202601

# 真实 provider 31 项 + 离线 mock 6 项（自建栈；--mock-only 先跑离线解析器）
node scripts/verify-ai.mjs --mock-only --source-db <snapshot.db> --port-start 5219
node scripts/verify-ai.mjs --bin <stage>/backend --source-db <snapshot.db> --port-start 5219 \
  --key-file F:\HolidayGuide\secrets\opencode.key

# 只读浏览器审计：逐页 + 图片真实加载 + 移动端 + 截图
node scripts/audit-images.mjs --base http://127.0.0.1:5201

# 封面唯一性：120 篇是否 120 张、每城 10 张、全部可加载
node scripts/audit-covers.mjs --base http://127.0.0.1:5201
```

`verify-upgrade` 默认拒绝对 5099 运行（需显式 `--allow-prod`）；`verify-ai` 只终止自己启动的 PID。详细说明见 [`docs/TESTING.md`](docs/TESTING.md)。

## 图片

城市封面按 `{slug}-01.jpg` … `{slug}-10.jpg` 命名（每个城市 10 张不同景点图），生成器按节日序号分配，保证同一城市 10 篇攻略的封面互不相同；节日封面为 `/images/holidays/{slug}.jpg`。图片位于 `holiday-travel-guide-web/public/images/`，构建时复制到 `wwwroot/images/`。

- **月度刷新**：`scripts/refresh-images.mjs` 从 Wikimedia Commons 按 `scripts/data/image-manifest.json` 搜索，只接受 JPEG + CC0/PD/CC BY/CC BY-SA，按月份轮换，下载到本地并同步 `wwwroot`；失败保留旧图，不阻断数据生成。
- **署名**：生成 `public/images/credits.json` 与 `CREDITS.md`；攻略详情页封面右下角显示「图：作者 / 许可」并链到 Commons 文件页，页脚有「图片来源与许可」汇总页 `/image-credits`。
- `scripts/audit-image-credits.mjs` 校验每张图都有署名、许可白名单、来源页与本地 JPEG。

## 安全

- 仓库不包含任何真实密钥；`appsettings.json` 中 token 为占位符。
- 生产 `Update:Token` 必须定期轮换，且只保存在部署目录的 `appsettings.json`（不进 git）。
- AI API Key 用环境变量 / User Secrets / `Ai:ApiKeyFile` 绝对路径注入；生产 key 文件放在 publish 之外（如 `F:\HolidayGuide\secrets\opencode.key`），仅授予 SYSTEM 读取权限，不随 robocopy 镜像。
- `/api/update/*` 仅靠 `X-Update-Token` 保护；请使用足够长的随机 token，并通过 TLS 暴露站点。
- 反向代理场景下，`X-Forwarded-For` 只信任可信代理链；不要直接把客户端头当作身份。
- 依赖升级前请检查已知漏洞；Node/.NET 依赖均带 lockfile。

更多内容见 [`docs/SECURITY.md`](docs/SECURITY.md)。

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 组件、数据流、更新状态机、缓存、AI RAG
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — 构建、服务、部署、Token 轮换、回滚
- [`docs/DATA_PIPELINE.md`](docs/DATA_PIPELINE.md) — 数据契约、生成器、Key 解析、月度任务
- [`docs/TESTING.md`](docs/TESTING.md) — 隔离测试栈、截图/视觉复核、测试脚本
- [`docs/SECURITY.md`](docs/SECURITY.md) — 密钥、Token、XFF、额度、漏洞报告

## License

[MIT](LICENSE) © 2026 ajwkb5159-cloud
