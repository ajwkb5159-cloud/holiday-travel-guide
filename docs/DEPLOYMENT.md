# 部署

以下路径均使用占位符：

- `<repo>`：源码根目录
- `<stage>`：发布暂存目录
- `<publish-root>`：生产发布目录（建议纯 ASCII 路径）
- `<backup-root>`：备份目录（必须在 `<publish-root>` 之外）

## 构建

```bash
# 前端必须先构建，产物会进入后端 wwwroot
cd <repo>/holiday-travel-guide-web
npm ci
npm run build
cd <repo>

dotnet publish HolidayGuideBackend -c Release -o <stage>/backend
dotnet publish HolidayGuideUpdater -c Release -o <stage>/updater
```

发布目录建议：

```text
<publish-root>/
├── backend/          # API + wwwroot + Data/holiday.db
└── updater/          # Worker + data/ + state.json + logs/
```

## Windows 服务

```bat
:: Updater（管理员；默认找 ..\publish\updater\HolidayGuideUpdater.exe）
scripts\install-updater-service.bat
scripts\install-updater-service.bat D:\apps\guide\updater\HolidayGuideUpdater.exe
scripts\uninstall-updater-service.bat
```

后端注册为服务时，`binPath` 指向 `backend\HolidayGuideBackend.exe`，工作目录即发布目录；程序以 `AppContext.BaseDirectory` 为内容根，避免把 `Data/`、`state.json` 写进 System32。

建议为两个服务配置失败自动重启（`sc failure ... reset= 86400 actions= restart/5000/...`）。

## 部署脚本

```powershell
# 管理员 PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-prod-elevated.ps1 `
  -Stage <stage> -PublishRoot <publish-root> -BackupRoot <backup-root> -RequireAiKey
```

行为：

1. 校验管理员与 stage；
2. 停 Backend / Updater；
3. 停服期间备份 SQLite 三件套（`holiday.db`、`-wal`、`-shm`）；
4. `robocopy /MIR` 后端、`wwwroot`、Updater；
5. **排除** `appsettings.json`、`appsettings.Development.json`、`Data`、`data`、`logs`、`state.json`；
6. 把生产配置备份到 `<backup-root>`；
7. 校验生产 `Ai.ApiKey` 长度（`-RequireAiKey` 时空值视为失败）；
8. 启动服务并查询 `/api/system/status`，日志写入 `<publish-root>/deploy-prod.log`。

常用开关：

- `-SkipBackend`：只更新 Updater，后端不重启（静态文件可另行热复制）。
- `-SkipUpdater`：只更新后端。
- `-BackendService` / `-UpdaterService` / `-StatusUrl`：自定义服务名与探测地址。

## Update Token 轮换

```powershell
# 管理员 PowerShell；脚本不打印 token，失败自动回滚
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rotate-update-token.ps1 `
  -PublishRoot <publish-root> -BackupRoot <backup-root>
```

流程：停 Updater/Backend → 备份两份 appsettings → 生成 32 字节随机 token → 同时写入 backend `Update:Token` 与 updater `Backend:UpdateToken` → 起 Backend → 验证「新 token 200 / 旧 token 401 / 匿名 status 200」→ 起 Updater。

生产 `appsettings.json` 不随部署覆盖，因此 token 只存在于部署目录；仓库中永远是占位符。

## 静态文件热更新

`wwwroot` 下的前端产物可热替换，无需重启后端：

```bash
cp -r <stage>/backend/wwwroot/* <publish-root>/backend/wwwroot/
```

`index.html` 会引用新的 hash 资源；旧 hash 文件可保留，不影响访问。

## 回滚

1. 停 Backend/Updater；
2. 从 `<backup-root>/publish-pre-*` 恢复二进制（保留当前 `appsettings.json`、`Data`、`data`、`state.json`）；
3. 起 Backend，验证 `/health` 与 `/api/system/status`；
4. 起 Updater。

数据回滚：

- 发布未 `complete` 时，旧数据仍在；
- 若已 `complete`，停 Updater，将 `<publish-root>/updater/data/{yyyyMM}` 改名移出（否则 catch-up 会立刻重发），再用上一月数据 `--run-once --month <prev>`，或恢复停服时的 DB 快照。

## 注意事项

- `appsettings.json` 不会热重载，改完必须重启服务。
- 更新期间读接口默认 503；如果确认原子切换无空窗，可把 `Update:BusyDuringUpdate` 设为 `false`。
- 前端 `npm run build` 会清空 `HolidayGuideBackend/wwwroot`，请先构建前端再 publish 后端。
- 生产路径建议纯 ASCII，避免 Windows 服务 `binPath` 与批处理的编码问题。
