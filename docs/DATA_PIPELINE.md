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
- 封面路径建议使用本地 `/images/...`；每个城市有 10 张景点图，命名为 `{slug}-01.jpg` … `{slug}-10.jpg`，生成器按节日序号分配，保证同城攻略封面不重复。图片源文件在 `holiday-travel-guide-web/public/images/`。

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
| `--smoke <externalId>` | 只生成 1 篇做通道体检（强制真实调用） |
| `--validate-only` | 只校验已有 partial，不生成 |
| `--assemble-only` | 不调 LLM，用 partial + baseline 组装 |
| `--segments 2\|3` | 每篇正文分段数；小输出上限模型建议 2 |
| `--concurrency N` | 并发篇数（默认 2） |
| `--no-fallback` | 不启用备用通道 |

- 免费优先：智谱 GLM-4-Flash → 硅基流动免费层；DashScope（付费/额度制）仅在显式 `--provider dashscope` 时使用。
- Key 解析链：`--api-key` → `--key-file` → `--key-dir` / `HOLIDAY_GUIDE_KEY_DIR` → 用户目录 `.zhipu.key` / `.siliconflow.key` / `.dashscope.key` → 环境变量 → 本机 MCP 配置。
- Windows 计划任务以 SYSTEM 身份运行时 `homedir()` = `systemprofile`，必须通过 `--key-dir`/`HOLIDAY_GUIDE_KEY_DIR` 指向真实用户目录。
- 每篇分 2 段生成，单段目标 900-1200 字；失败篇目复用上一月同 `externalId` 内容，保证产出稳定。
- 生成结束会跑 `validateAll`；不通过则不写 `guides.json`。

## 月度自动化

```bat
:: 1) 复制本地配置（gitignored），填写 KEYDIR / PUBDIR / provider
copy scripts\monthly-data.local.bat.example scripts\monthly-data.local.bat

:: 2) 幂等运行：当月已投料则跳过；--force 强制重生成
scripts\run-monthly-data.bat
scripts\run-monthly-data.bat --force

:: 3) 注册计划任务（管理员；SYSTEM）
scripts\install-monthly-task.bat
::   HolidayGuideMonthlyDataGen        每月 1 日 02:00
::   HolidayGuideMonthlyDataGenCatchup 每天 12:00（补跑）
```

`run-monthly-data.bat` 流程：主通道 smoke 预检 → 全量生成 → 校验 → `xcopy` 到 `<PUBDIR>/{yyyyMM}/` → Updater 5 分钟内自动发布。smoke 失败不会投料，线上继续服务上一期。

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
