# 安全

## 密钥与配置

- 仓库中的 `Update:Token` / `Backend:UpdateToken` 是占位符 `dev-only-token-change-me`，**不是生产 token**。
- 生产 token 只存在于部署目录的 `appsettings.json`，该文件被部署脚本排除，永不随镜像覆盖。
- AI API Key 推荐通过 `Ai:ApiKeyFile`（绝对路径，文件在 publish 之外）、环境变量 `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY`、或 .NET User Secrets 注入；不要提交到仓库。不再保留 DashScope 回退。
- 生产 key 文件示例：`F:\HolidayGuide\secrets\opencode.key`，ACL 仅 SYSTEM 读取、Administrators 完全、当前用户只读；`robocopy /MIR` 不会碰它。
- 仓库忽略 `*.key`、`.env*`、`appsettings.json.bak*`、`monthly-data.local.bat` 等本机配置。
- 部署脚本在停服窗口备份 SQLite 三件套与两份 appsettings 到 `<backup-root>`（publish 之外），避免下一次镜像误删。

## Update Token

- `/api/update/*` 只有一层 `X-Update-Token` 保护；token 必须足够长（推荐 32 字节随机 hex）。
- 通过提权脚本轮换：

```powershell
scripts\rotate-update-token.ps1 -PublishRoot <publish-root> -BackupRoot <backup-root>
```

- 脚本不打印 token；先备份配置，轮换后验证「新 token 200 / 旧 token 401 / 匿名 status 200」，失败自动回滚。
- 站点必须通过 TLS 暴露；token 走明文 HTTP 会被中间人截获。

## 反向代理与客户端 IP

- Kestrel 默认只绑回环，公网访问经反向代理/隧道。
- AI 额度按 IP 限流；代理后 `RemoteIpAddress` 可能恒为代理地址，必须解析 `X-Forwarded-For` 首段（`ClientIpResolver.Resolve`）。
- 只信任你控制的反向代理链；不要把客户端可伪造的 `X-Forwarded-For` 直接当作身份。
- 全局日上限 `Ai:GlobalDailyCap` 是 XFF 伪造的兜底。

## 输入与渲染

- SQL 全部经 SqlSugar 参数化/ORM，不拼接用户输入。
- 攻略正文由 DOMPurify 清洗后渲染；`script` 标签被移除，`img` 加 `loading=lazy`、`decoding=async`、`referrerpolicy=no-referrer`。
- 搜索/标题高亮先转义再包裹 `<em>`，避免 XSS。
- AI 问题截断到 500 字；上游错误信息不回显敏感配置。

## 额度与滥用

- AI：每 IP 日限 + 全局日上限；串行并发闸；排队超时 429。
- 搜索/推荐为只读接口，无写入副作用；如公开部署，建议在反向代理层加基础限流。
- 收藏/行为信号只存 localStorage，无服务端写入接口。

## 依赖

- .NET/NuGet 与 npm 依赖均带 lockfile（`package-lock.json`）。
- 升级前检查已知漏洞（`dotnet list package --vulnerable`、`npm audit`）。
- Playwright 仅作为 devDependency，用于本地测试；生产不需要浏览器运行时。

## 漏洞报告

请通过仓库 Issue 或维护者公开的联系方式私下报告安全问题，不要在公开 Issue 中贴出可利用细节、token 或密钥。收到后会尽快确认并修复。

## 公开仓库前的检查清单

- [ ] 两份 appsettings 的 token 已是占位符
- [ ] 没有 `*.key`、`.env`、生产 `appsettings.json`、日志、DB、`state.json`
- [ ] `git grep` 检查旧 token、`sk-`、`ghp_`、生产域名/绝对路径零命中
- [ ] 生产 token 已轮换（或确认从未公开）
- [ ] AI key 不在仓库；生产 `Ai.ApiKey` 为空时 `ApiKeyFile` 指向的文件存在且 ACL 正确
- [ ] 示例数据不含隐私信息
