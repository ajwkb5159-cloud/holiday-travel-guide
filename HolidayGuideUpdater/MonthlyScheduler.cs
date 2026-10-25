using Microsoft.Extensions.Hosting.WindowsServices;

namespace HolidayGuideUpdater;

/// <summary>
/// 月度触发调度（服务模式每 5 分钟巡检，两阶段）：
///   ① 补跑检测（catch-up）：数据目录最新月份 > 后端库已发布月份（或库空）→ 立即系统性更新。
///      用于服务器掉线后重启的场景，不受 3 点定时与 24h 失败冷却限制；失败按配置重试，仍失败下一轮再查。
///   ② 常规月度巡检：到点且有当月数据时触发；失败 24 小时内不重试（次日补跑）。
/// 控制台模式（--run-once 或非服务形态）：直接跑一次后退出，方便调试。
/// </summary>
public class MonthlyScheduler(
    BatchIngestionService ingestion,
    StateStore stateStore,
    GuideDataSource dataSource,
    IConfiguration config,
    IHostApplicationLifetime lifetime,
    ILogger<MonthlyScheduler> logger) : BackgroundService
{
    /// <summary>当月数据缺失告警的最后日期（避免 5 分钟轮询刷屏）</summary>
    private DateTime? _lastMissingDataWarnDate;
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var dataDir = config["Updater:DataDir"] ?? "data";
        var args = Environment.GetCommandLineArgs();
        var runOnce = args.Contains("--run-once");
        var monthArg = args.SkipWhile(a => a != "--month").Skip(1).FirstOrDefault();

        if (runOnce || !WindowsServiceHelpers.IsWindowsService())
        {
            if (args.Contains("--catch-up"))
            {
                // 手动补跑：执行一轮补跑判定（与服务形态同一代码路径），不落常规巡检
                try
                {
                    await RunCatchUpCycleAsync(dataDir, stoppingToken);
                    logger.LogInformation("手动补跑判定完成");
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "手动补跑失败");
                }
                finally
                {
                    lifetime.StopApplication();
                }
                return;
            }
            var monthKey = monthArg ?? DateTime.Now.ToString("yyyyMM");
            try
            {
                await ingestion.RunAsync(monthKey, stoppingToken);
                logger.LogInformation("一次性运行完成: {MonthKey}", monthKey);
            }
            finally
            {
                lifetime.StopApplication();
            }
            return;
        }

        var runHour = config.GetValue("Updater:RunHour", 3);
        var runMinute = config.GetValue("Updater:RunMinute", 0);
        var catchUpOnStart = config.GetValue("Updater:CatchUpOnStart", true);
        var catchUpRetries = config.GetValue("Updater:CatchUpRetryCount", 3);
        var catchUpRetryDelaySec = config.GetValue("Updater:CatchUpRetryDelaySec", 30);
        var startupDelaySec = config.GetValue("Updater:CatchUpStartupDelaySec", 15);

        if (startupDelaySec > 0)
        {
            // 等后端服务完成启动（两个服务同机自动拉起时存在先后）
            logger.LogInformation("补跑等待 {Delay} 秒后开始巡检", startupDelaySec);
            await Task.Delay(TimeSpan.FromSeconds(startupDelaySec), stoppingToken);
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTime.Now;
                var current = now.ToString("yyyyMM");
                var state = stateStore.Load();

                // ---------- ① 补跑检测：库内已发布月份落后于数据目录最新月份 → 系统性更新 ----------
                if (catchUpOnStart)
                {
                    await RunCatchUpCycleAsync(dataDir, stoppingToken);
                    // 补跑可能刚完成本月发布；必须重新读取 state，否则下面的常规巡检会拿旧 state 再发一次
                    state = stateStore.Load();
                }

                // ---------- ② 常规月度巡检 ----------
                var alreadyDone = state.Status == "completed" && state.MonthKey == current;
                var failedRecently = state.Status == "failed"
                    && DateTime.TryParse(state.UpdatedAt, out var updatedAt)
                    && (now - updatedAt).TotalHours < 24;
                var afterRunTime = now.Hour > runHour || (now.Hour == runHour && now.Minute >= runMinute);
                var hasCurrentData = dataSource.HasData(current, dataDir);

                if (!alreadyDone && !failedRecently && afterRunTime && hasCurrentData)
                {
                    await ingestion.RunAsync(current, stoppingToken);
                }
                else if (!alreadyDone && afterRunTime && !hasCurrentData && _lastMissingDataWarnDate != now.Date)
                {
                    // 当月数据缺失：生成侧（上位机）没投料，这里是唯一的“没人干活”可见信号（每天最多告警一次）
                    _lastMissingDataWarnDate = now.Date;
                    logger.LogWarning("当月 {Current} 数据文件缺失（{Path}），本期无法发布，线上仍为上一期数据；请检查上位机生成任务（脚本 scripts/run-monthly-data.bat / 计划任务 HolidayGuideMonthlyDataGen）",
                        current, Path.Combine(AppContext.BaseDirectory, dataDir, current, "guides.json"));
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "月度巡检异常，5 分钟后继续");
            }
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
        }
    }

    /// <summary>一轮补跑判定：数据目录最新月份 vs 后端库已发布月份，落后则触发系统性更新</summary>
    private async Task RunCatchUpCycleAsync(string dataDir, CancellationToken ct)
    {
        var catchUpRetries = config.GetValue("Updater:CatchUpRetryCount", 3);
        var catchUpRetryDelaySec = config.GetValue("Updater:CatchUpRetryDelaySec", 30);
        var newestMonth = dataSource.FindNewestMonth(dataDir);
        if (string.IsNullOrEmpty(newestMonth))
        {
            logger.LogInformation("补跑判定: 数据目录无可用数据文件，跳过");
            return;
        }

        var backend = await ingestion.GetBackendStatusAsync(ct);
        if (backend is null)
        {
            logger.LogWarning("后端状态不可达，本轮跳过补跑判定");
            return;
        }
        if (backend.IsUpdating)
        {
            logger.LogInformation("后端更新会话进行中，本轮跳过补跑（等下一轮）");
            return;
        }

        var backendMonth = backend.LastMonthKey ?? string.Empty;
        var needCatchUp = string.CompareOrdinal(backendMonth, newestMonth) < 0
            || (backend.GuideCount == 0 && backendMonth != newestMonth);
        if (!needCatchUp)
        {
            logger.LogInformation("补跑判定: 库内 {BackendMonth} 与最新数据 {NewestMonth} 一致，无需补跑",
                backendMonth, newestMonth);
            return;
        }

        logger.LogWarning("检测到数据落后: 库内已发布 {BackendMonth}({GuideCount} 条) < 最新数据 {NewestMonth}，触发系统性数据更新",
            string.IsNullOrEmpty(backendMonth) ? "无" : backendMonth, backend.GuideCount, newestMonth);
        await RunWithRetryAsync(newestMonth, catchUpRetries, catchUpRetryDelaySec, ct);
    }

    /// <summary>补跑专用重试：失败按配置次数重试（区别于常规巡检的 24h 冷却，掉线恢复场景要尽快补上）</summary>
    private async Task RunWithRetryAsync(string monthKey, int retries, int delaySec, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await ingestion.RunAsync(monthKey, ct);
                logger.LogInformation("补跑完成: {MonthKey}", monthKey);
                return;
            }
            catch (Exception ex)
            {
                if (attempt >= retries)
                {
                    logger.LogError(ex, "补跑 {MonthKey} 重试 {Count} 次仍失败，5 分钟后下一轮再查", monthKey, retries);
                    return; // 本轮放弃，外层循环下一轮（5 分钟后）重新判定
                }
                logger.LogWarning(ex, "补跑 {MonthKey} 失败(第 {Attempt} 次)，{Delay} 秒后重试", monthKey, attempt, delaySec);
                await Task.Delay(TimeSpan.FromSeconds(delaySec), ct);
            }
        }
    }
}
