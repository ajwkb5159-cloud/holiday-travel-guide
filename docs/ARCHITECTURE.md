# 架构

## 组件

| 组件 | 技术 | 职责 |
|------|------|------|
| `HolidayGuideBackend` | ASP.NET Core 10、SqlSugar、SQLite(WAL) | 只读 API、更新 API、AI SSE、服务门、静态页/SPA fallback |
| `HolidayGuideUpdater` | .NET Worker Service | 读取 `data/{yyyyMM}/guides.json`，begin/batch/complete 原子投料，5 分钟巡检 + catch-up |
| `holiday-travel-guide-web` | Vue 2.7、Element UI、Vite 5 | SPA；`npm run build` 产物写入后端 `wwwroot` |
| `scripts/` | Node / Batch / PowerShell | 数据生成、月度任务、部署、验证 |

## 请求链路

```text
Browser
  │  GET /  /guides  /destinations ...
  ▼
Kestrel :5099
  ├─ UseResponseCompression   (必须早于静态文件)
  ├─ UseStaticFiles(wwwroot)  (命中即短路)
  ├─ SPA fallback             (history 路由)
  ├─ UpdateAuthMiddleware     (/api/update/* 校验 X-Update-Token)
  ├─ ServiceGateMiddleware    (更新/空库时读接口 503)
  └─ Controllers → BLL → SqlSugar → SQLite(WAL)
```

- API JSON 输出 **PascalCase**（`Program.cs` 关闭 camelCase 策略），前端按 PascalCase 读取。
- `/api/*` 读接口无鉴权；`/api/update/*` 需要 `X-Update-Token`；`/api/system/status` 与 `/health` 公开。
- 静态资源与 SPA fallback 不受服务门影响：更新期间页面仍能加载，由前端遮罩提示。

## 更新状态机

```text
POST /api/update/begin   → UpdateJob(Running) + IsUpdating=true
POST /api/update/batch   → 插入 Published=0 的 Guides/GuideTags/Holidays
POST /api/update/complete→ 单事务：删除旧 Published=1 数据 → 本批置 Published=1
                            → 重建 FTS5 → UpdateJob(Complete) → 刷新 HasData
POST /api/update/abort   → 删除本批未发布数据 → UpdateJob(Abort)
```

- 单写者锁；超时会话会被清理。
- `complete` 时统计 `GuideCount` / `HolidayCount` 并写 `FinishedAt`。
- old schema 启动时补 `MonthKey` 列并按 `FinishedAt` 回填，避免升级后误触发全量重推。
- FTS5 在发布后重建；搜索无命中时降级 LIKE 子串匹配。

## 缓存

- 进程内 L1 缓存：首页聚合、攻略列表/详情、目的地、节日、标签、搜索等。
- `complete` 后失效相关缓存；`/api/system/status` 的计数实时查询数据库。
- 更新期间 `ServiceStatus.IsUpdating` 为进程内单例；`HasData` 启动时按已发布攻略数初始化。

## 服务门

- 触发 503：`IsUpdating && Update:BusyDuringUpdate` 或 `!HasData && Update:BusyWhenEmpty`。
- 放行：`/api/update/*`、`/api/system/*`、`/health`、静态文件/SPA。
- 前端 `MaintenanceOverlay` 按 5s/30s 轮询 status；busy → normal 后整页刷新一次。
- 逃生门：把两个开关设为 `false` 可在更新期间继续读旧数据（原子切换本身没有空窗）。

## AI 行程助手

- `POST /api/ai/chat` 返回 SSE：`delta`（增量文本）、`sources`（引用攻略）、`done`、`error`。
- RAG：`ISearchService.RetrieveForRagAsync`；自然语言长句先走站内词库扩展（目的地/分类/标签词二次检索），再拼上下文。
- 上游为 OpenAI 兼容流式接口，默认 OpenCode Go `deepseek-v4.1-flash`；`BaseURL` 必须是完整 `/chat/completions` 端点。
- Key 解析链：`ApiKey` → `ApiKeyFile` → `OPENCODE_*` 环境变量；不再保留 DashScope 回退。
- 默认 `Ai:QuotaEnabled=false`：不计数、不限次，前端不显示额度角标；开启后首个**正文**增量到达才扣额度，仅 `reasoning_content`/连接失败/超时不扣费。
- 上下文：`HistoryMaxTurns=500`、`HistoryMaxChars=1,500,000`、`HistoryPerMessageChars=50,000`；前端最多带 500 条历史，后端从旧到新按字符预算裁剪，支持模型 1M token 上下文。
- 解析器容忍空 `choices`、usage-only chunk；非 SSE 200 走 JSON 回退；`finish_reason=length` 且无正文时返回明确错误。
- DeepSeek 系模型若要求历史 assistant 消息带 `reasoning_content`，`Ai:SendReasoningContent=true` 会透传 `reasoning` 事件并在前端隐藏保存；前端首次发送时不再把欢迎气泡和历史里的当前问题重复发送。
- 并发闸 `SemaphoreSlim(MaxConcurrent)`；排队超时返回 429。
- 额度表 `AiQuota(Day,Scope,Count)`，Scope=`ip:x.x.x.x` 或 `global`；仅在开启额度时写入，惰性清理保留 7 天。
- 反向代理后必须解析 `X-Forwarded-For` 首段（开启额度时用于按 IP 计数）。

## 个性化推荐

- 前端把浏览/收藏写入 localStorage `holiday-guide-behavior`（无写接口）。
- `GET /api/guide/recommend` 按目的地 ×2.0、分类 ×1.2、标签 ×1.0、当季 ×0.2、log10(浏览量) ×0.3 + 日盐打散打分。
- 无行为信号时首页「猜你喜欢」整块隐藏。

## 前端

- Vue 2.7 + Element UI；路由 history 模式，依赖后端 SPA fallback。
- 卡片封面统一用 CSS `background-image`（双层：图片 + 季节渐变，容器带 `background-color` 兜底）；每个城市有 10 张景点图，按节日序号分配给不同攻略，避免同城封面重复；URL 带 `?v=yyyyMM` 做月度缓存失效。
- 详情页封面右下角读取 `/images/credits.json` 显示「图：作者 / 许可」，链到 Wikimedia Commons 文件页；页脚有 `/image-credits` 汇总页。
- 详情正文经 DOMPurify 清洗；`img` 自动加 `loading=lazy`、`decoding=async`、`referrerpolicy=no-referrer` 和失败隐藏。
- 移动端导航横向滚动 + 分页器 5 个页码，避免 390px 页面横向溢出。

## 已知边界

- 节假日封面已入库并随 API 返回，但当前前端未在节日列表渲染（可扩展）。
- 收藏/行为信号是纯前端 localStorage，换设备不同步。
- 月度生成器依赖外部 LLM；质量与配额由所选 provider 决定。
