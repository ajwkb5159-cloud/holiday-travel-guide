# 数据管线

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

约束：

- `externalId` 全局唯一，≤64 字符。
- `content` 为 HTML；前端 DOMPurify 清洗后渲染。
- `holidays` 只在批次 0 发送一次，否则会重复插入。
- 封面路径使用本地 `/images/...`；每个城市有 10 张景点图，命名为 `{slug}-01.jpg` … `{slug}-10.jpg`，生成器按节日序号分配，保证同城攻略封面不重复。图片源文件在 `holiday-travel-guide-web/public/images/`。
- 封面 URL 带 `?v=yyyyMM`（如 `/images/destinations/beijing-01.jpg?v=202610`），用于月度换图后的浏览器缓存失效；查署名时剥离 query string。

## 投料流程

```text
data/{yyyyMM}/guides.json
  │
  ▼
HolidayGuideUpdater
  ├─ 加载 JSON（回退 data/latest/guides.json）
  ├─ POST /api/update/begin  { monthKey }
  ├─ 每 BatchSize 条 POST /api/update/batch（Holidays 只在第 0 批发）
  └─ POST /api/update/complete
        │
        ▼
Backend 单事务：删除旧 Published=1 → 新批置 Published=1 → 重建 FTS5
```

- `state.json` 记录 `MonthKey / Status / LastBatchIndex / TotalBatches / ...`，中断后可续跑。
- Updater 每 5 分钟巡检：
  1. **补跑判定**：数据目录最新月份 > 后端 `LastMonthKey`（或库空）→ 立即 `RunAsync`，失败按 `CatchUpRetryCount` 重试；
  2. **常规月度**：当月、到点（默认 03:00 后）、未完成、且当月数据存在 → 投料。
- 补跑完成后调度器会重新读取 `state.json`，避免同一轮常规巡检重复发布。
- 手动运行前先停 Updater 服务，避免两个进程同时写 `state.json`。

## 生成器

`scripts/gen-real.mjs`：

```bash
node scripts/gen-real.mjs --month 202610 \
  --provider zhipu --fallback-provider siliconflow \
  --concurrency 2 --segments 2
```

常用参数：

| 参数 | 说明 |
|------|------|
| `--month yyyyMM` | 目标月份（默认当月），输出 `HolidayGuideUpdater/data/{yyyyMM}/` |
| `--baseline auto\|yyyyMM\|none` | 失败篇目的兜底来源（默认上一月） |
| `--provider` / `--fallback-provider` | 主/备 LLM 通道 |
| `--key-dir DIR` | key 文件目录；SYSTEM 计划任务必须显式指定 |
| `--probe-keys` | 只探测各通道 key 是否可读后退出 |
| `--require-primary` | 配合 `--probe-keys`：主通道没有 key 就失败 |
| `--smoke <externalId>` | 只生成 1 篇做通道体检（强制真实调用） |
| `--validate-only` | 只校验已有 partial，不生成 |
| `--assemble-only` | 不调 LLM，用 partial + baseline 组装 |
| `--segments 2\|3` | 每篇正文分段数；小输出上限模型建议 2 |
| `--concurrency N` | 并发篇数（默认 2） |
| `--no-fallback` | 不启用备用通道 |
| `--fresh` | 生成前把旧 `partial/` 移到 `partial.bak-{timestamp}/`，避免 `--force` 复用旧内容 |
| `--allow-reuse N` | 兜底复用篇数上限；全量刷新用 `0` |
| `--facts auto\|none\|<file>` | 事实底稿来源；默认自动读取 `data/{yyyyMM}/facts.json` 或最近缓存 |
| `--max-content N` | 正文长度上限（默认 6000；7 天长假攻略需要更高上限） |

- 主通道：OpenCode Go `deepseek-v4.1-flash`（`F:\HolidayGuide\secrets\opencode.key`，支持 `response_format:json_object`）→ 备 智谱 GLM-4-Flash / 硅基流动免费层。**DashScope/qwen-flash 已移除**。
- Key 解析链：`--api-key` → `--key-file` → provider key 文件（OpenCode 用绝对路径）→ `--key-dir` / `HOLIDAY_GUIDE_KEY_DIR` 下的 `.zhipu.key` / `.siliconflow.key` → `OPENCODE_*` 环境变量 → 本机 MCP 配置。
- OpenCode 调用带 `User-Agent: HolidayGuideDataBot/1.0` + `x-opencode-session`；`response_format:json_object` 实测可用。
- Windows 计划任务以 SYSTEM 身份运行时 `homedir()` = `systemprofile`，必须通过 `--key-dir`/`HOLIDAY_GUIDE_KEY_DIR` 指向真实用户目录。
- **节日窗口**：`scripts/lib/holidays.mjs` 用 `lunar-javascript` 从目标月前 3 个月起滚动 12 个月，动态计算农历节日（春节/端午/七夕/中秋/重阳）、节气（清明）和固定节日；闰月不参与，202610 与历史 10 个日期完全一致。`scripts/test-holidays.mjs` 做离线回归。
- **公开事实层**：`scripts/refresh-facts.mjs` 以中文 Wikivoyage（旅行向内容）为主源抓取城市/景点摘要，并读取官方节假日安排（`timor.tech`，失败可降级），写入 `data/{yyyyMM}/facts.json`；生成器把目的地/景点事实注入 prompt，并要求票价/营业时间等易变信息写区间或「以景区公告为准」。中文 Wikipedia 在部分国内网络不可达，不作为必需源。
- 每篇分 2 段生成，单段目标 900-1200 字；失败篇目仅在节日日期/天数/季节仍匹配时才复用上一月同 `externalId` 内容，避免旧内容复活。
- 生成结束会跑 `validateAll`；不通过则不写 `guides.json`。`scripts/validate-month.mjs` 可对源文件或已投料副本做独立校验（120 篇/10 节日/日期窗口/本地封面/署名）。

## 月度自动化

```bat
:: 0) 安装脚本侧依赖（农历）
npm ci --prefix scripts

:: 1) 复制本地配置（gitignored），填写 KEYDIR / PUBDIR / provider / PUBLISH_WWWROOT
copy scripts\monthly-data.local.bat.example scripts\monthly-data.local.bat

:: 2) 无 LLM 预检：Node / lunar-javascript / 主通道 key / PUBDIR 可写
scripts\run-monthly-data.bat --probe

:: 3) 幂等运行：当月已投料且校验通过才跳过
scripts\run-monthly-data.bat
scripts\run-monthly-data.bat --force
scripts\run-monthly-data.bat --fresh --force   :: 全量重生成，旧 partial 移到 backup

:: 4) 注册计划任务（管理员；SYSTEM）
scripts\install-monthly-task.bat
::   HolidayGuideMonthlyDataGen        每月 1 日 02:00
::   HolidayGuideMonthlyDataGenCatchup 每天 12:00（补跑）

:: 5) 提权核验任务与 SYSTEM 上下文
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-schedule.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-monthly-task-elevated.ps1
```

`run-monthly-data.bat` 流程：环境/key 预检 → 已投料文件先 `validate-month`（坏文件不再永久跳过）→ 刷新公开事实（失败复用缓存）→ 刷新 Commons 图片（失败保留旧图）→ 主通道 smoke 预检 → 全量生成（可按需 `--fresh`/`--allow-reuse`）→ 源文件校验 → `robocopy` 排除 `partial/`/`failed.jsonl` → 投料副本再校验 → 写 `.SUCCESS`。smoke 或校验失败不会投料，线上继续服务上一期。

> 同月重发不会被 Updater 的 catch-up 自动触发（`state.json` 已完成且后端月份等于最新数据月份）。需要重发当前月时：停 `HolidayGuideUpdater` 服务 → `HolidayGuideUpdater.exe --run-once --month <yyyyMM>` → 起服务。推荐直接用提权脚本 `scripts\publish-month-elevated.ps1 -Month <yyyyMM>`：它会先跑 `validate-month`，停服备份 DB/配置/wwwroot 图片/旧投料目录，起 Backend，跑 `--run-once`，起 Updater，并校验 120 篇/10 节日。

## 数据新鲜度与陈旧告警

- `UpdateJob.MonthKey/GuideCount/HolidayCount` 记录发布元数据。
- `/api/system/status` 返回 `LastMonthKey`、`LastPublishTime`、`DataAgeDays`、`IsStale`。
- `Update:StaleThresholdDays`（默认 40）控制 `IsStale`。
- 当月数据文件缺失时 Updater 每天最多一条 warning，作为「没人干活」的可见信号。
- 页脚在 `IsStale=true` 时追显「数据可能已过期」。

## 回滚

- 投料失败/中断：`abort` 会清理本批未发布数据；旧数据仍在。
- 已 `complete` 但需要回滚：
  1. 停 Updater；
  2. 把 `<publish-root>/updater/data/{yyyyMM}` 改名移出（否则 catch-up 会立即重发）；
  3. 用上一月数据 `--run-once --month <prev>`，或恢复停服时的 DB 快照；
  4. 起 Updater。
