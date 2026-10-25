# 测试

## 原则

- 所有写操作（`/api/update/begin|batch|complete|abort`、AI 真实调用）只在**隔离测试栈**执行。
- 生产只做只读浏览器冒烟：GET 页面/API、图片探测、截图；不写库、不调更新接口、不发送 AI 聊天。
- 测试栈使用全新端口 + 生产库快照（`holiday.db` + `-wal` + `-shm`），不触碰生产。
- 测完按 PID 停止测试进程，`netstat` 确认端口释放，确认生产服务 PID 未变。

## 测试栈

```powershell
# 1) 构建（先前端后 .NET）
cd holiday-travel-guide-web; npm run build; cd ..
dotnet publish HolidayGuideBackend -c Release -o <stage>/backend
dotnet publish HolidayGuideUpdater -c Release -o <stage>/updater

# 2) 复制后端到测试目录
$run = '<repo>\.test-env\run-5201'
Copy-Item '<stage>\backend\*' $run -Recurse -Force
New-Item -ItemType Directory -Force "$run\Data" | Out-Null
Copy-Item '<publish-root>\backend\Data\holiday.db*' "$run\Data\" -Force

# 3) 写测试 appsettings：端口 5201、Update.Token=test-token-only、Ai.Enabled=false
# 4) 直接起 exe（不要 dotnet run，避免 launchSettings 抢端口）
Start-Process "$run\HolidayGuideBackend.exe" -WorkingDirectory $run -PassThru
```

- 端口从 5201 起探测，绝不使用 5099。
- 测试库快照在停服窗口复制最稳；运行中复制需确认 WAL 状态。

## 脚本

| 脚本 | 覆盖 | 说明 |
|------|------|------|
| `scripts/e2e-verify-v2.mjs` | 37 项 | 逐页访问、排序、搜索高亮/历史、收藏、XSS、断图兜底、移动端 |
| `scripts/verify-upgrade.mjs` | 13 项 | 页脚新鲜度、更新中 503、遮罩、恢复自动刷新、移动端 |
| `scripts/verify-ai.mjs` | 34 项 | 推荐、AI 流式、引用卡、额度、限流、上游故障不计费、关闭模式 |
| `scripts/audit-images.mjs` | 只读审计 | 逐页 console/network、CSS 背景图真实加载、断图兜底、移动端、截图 |
| `scripts/audit-covers.mjs` | 封面审计 | 120 篇是否 120 个唯一封面、每城是否 10 张、所有图片是否可加载 |

示例：

```bash
node scripts/e2e-verify-v2.mjs --base http://127.0.0.1:5201
node scripts/verify-upgrade.mjs --base http://127.0.0.1:5201 --token test-token-only --month 202601
node scripts/verify-ai.mjs --bin <stage>/backend --source-db <snapshot.db> --port-start 5219
node scripts/audit-images.mjs --base http://127.0.0.1:5201 --block-images
node scripts/audit-covers.mjs --base http://127.0.0.1:5201
```

安全约束：

- `verify-upgrade.mjs` 默认拒绝对 `:5099` 运行（需显式 `--allow-prod`），并支持 `--token` / `UPDATE_TOKEN` / `--config`。
- `verify-ai.mjs` 只 `taskkill` 自己启动的 PID，端口从 `--port-start` 起探测并跳过 5099。
- `audit-images.mjs` 只发 GET；`--block-images` 用于验证断图兜底。

## 图片审计指标

- 提取所有 `background-image` URL，用页面内 `new Image()` 并发探测（10s 超时）。
- 统计成功率、p50/p95、失败域名；本地自托管图片应 100% 成功、p95 接近 0ms。
- 断图模式检查容器是否有非透明 `background-color` 或季节渐变。
- 截图后用视觉复核：布局、对齐、文字可读性、空态、断图兜底。

## 视觉复核

截图目录：`.test-env/shots-*` / `.test-env/audit-*`。重点查看：

- 首页：倒计时、当季推荐、临近节日攻略、热门榜单/目的地。
- 攻略列表：卡片图、分页器、筛选栏。
- 详情：头图、正文排版、引用/收藏。
- 目的地/节假日/标签/搜索/收藏空态。
- 移动端 390×844：导航、两列卡片、分页器、回到顶、AI 悬浮球。
- 更新遮罩：桌面 + 移动端。

## 清理

```powershell
# 按 PID 停止测试进程
Stop-Process -Id <pid> -Force
# 确认端口释放
netstat -ano | findstr :5201
# 确认生产服务仍在
sc query HolidayGuideBackend
sc query HolidayGuideUpdater
```

保留截图与 `report.json` 作为证据；删除测试库副本和临时 stage（确认不再需要后）。
