using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using HolidayGuideBackend.Infrastructure.Dtos;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>
/// 写入流程编排：begin → batch(Published=0) → complete(原子切换) → abort。
/// 核心并发安全：单写者锁 + 原子切换事务 + 超时遗留清理。
/// 同时维护 ServiceStatus 运行态（IsUpdating/HasData）与上次发布元数据（MonthKey/时间/条数）。
/// </summary>
public class UpdateService : IUpdateService
{
    private readonly ISqlSugarClient _db;
    private readonly UpdateSessionManager _sessionManager;
    private readonly ILogger<UpdateService> _logger;
    private readonly ICacheInvalidator _cache;
    private readonly IFtsSync _ftsSync;
    private readonly ServiceStatus _status;
    private readonly IConfiguration _config;

    /// <summary>会话超时阈值：超过则视为遗留，下次 begin 清理</summary>
    private static readonly TimeSpan SessionTimeout = TimeSpan.FromMinutes(30);

    public UpdateService(ISqlSugarClient db, UpdateSessionManager sm, ILogger<UpdateService> logger, ICacheInvalidator cache, IFtsSync ftsSync, ServiceStatus status, IConfiguration config)
    {
        _db = db; _sessionManager = sm; _logger = logger; _cache = cache; _ftsSync = ftsSync; _status = status; _config = config;
    }

    public async Task<string?> BeginSessionAsync(string? monthKey = null)
    {
        // 1. 尝试获取进程内写锁
        var session = await _sessionManager.TryBeginAsync(TimeSpan.FromSeconds(5));
        if (session is null)
        {
            _logger.LogWarning("已有更新会话在跑，begin 被拒绝");
            return null;
        }

        try
        {
            // 2. 清理数据库中超时遗留的会话 + 孤儿未发布数据
            await CleanupStaleSessionsAsync();

            // 3. 写入 UpdateJob 记录
            var now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            var job = new UpdateJob
            {
                JobId = session.JobId,
                BatchId = session.JobId, // BatchId 复用 JobId
                Status = "Running",
                MonthKey = string.IsNullOrWhiteSpace(monthKey) ? null : monthKey,
                StartedAt = now,
                InsertedCount = 0,
                BatchCount = 0
            };
            await _db.Insertable(job).ExecuteCommandAsync();

            // 4. 更新进程内运行态：读接口进入「服务器繁忙」窗口
            _status.SetUpdating(true);
            return session.JobId;
        }
        catch
        {
            _sessionManager.Release(session);
            throw;
        }
    }

    public async Task<bool> InsertBatchAsync(BatchInsertRequest req)
    {
        var current = _sessionManager.Current;
        if (current is null || current.JobId != req.JobId)
        {
            _logger.LogWarning("batch 请求会话不匹配: {JobId}", req.JobId);
            return false;
        }

        // 单事务插入本批攻略 + 标签（均 Published=0）
        try
        {
            await _db.Ado.UseTranAsync(async () =>
            {
                var now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                foreach (var item in req.Guides)
                {
                    var guide = new Guide
                    {
                        ExternalId = string.IsNullOrEmpty(item.ExternalId) ? Guid.NewGuid().ToString("N") : item.ExternalId,
                        Title = item.Title,
                        Summary = item.Summary ?? string.Empty,
                        Content = item.Content ?? string.Empty,
                        CoverImage = item.CoverImage ?? string.Empty,
                        Destination = item.Destination ?? string.Empty,
                        Region = item.Region ?? string.Empty,
                        Season = item.Season ?? string.Empty,
                        HolidayName = item.HolidayName ?? string.Empty,
                        HolidayDate = item.HolidayDate ?? string.Empty,
                        Days = item.Days,
                        Category = item.Category ?? string.Empty,
                        Tags = string.Join(",", item.Tags ?? new List<string>()),
                        ViewCount = 0,
                        Published = 0,
                        BatchId = req.BatchId,
                        CreatedAt = now
                    };
                    var newId = await _db.Insertable(guide).ExecuteReturnIdentityAsync();

                    if (item.Tags is { Count: > 0 })
                    {
                        var tags = item.Tags.Select(t => new GuideTag
                        {
                            Tag = t,
                            GuideId = newId,
                            BatchId = req.BatchId,
                            Published = 0
                        }).ToList();
                        await _db.Insertable(tags).ExecuteCommandAsync();
                    }
                }

                if (req.Holidays is { Count: > 0 })
                {
                    var holidays = req.Holidays.Select(h => new Holiday
                    {
                        Name = h.Name,
                        Date = h.Date,
                        Type = h.Type ?? string.Empty,
                        IsLegal = h.IsLegal,
                        Description = h.Description ?? string.Empty,
                        CoverImage = h.CoverImage ?? string.Empty,
                        BatchId = req.BatchId,
                        Published = 0
                    }).ToList();
                    await _db.Insertable(holidays).ExecuteCommandAsync();
                }

                // 更新计数
                await _db.Updateable<UpdateJob>()
                    .SetColumns(j => new UpdateJob { InsertedCount = j.InsertedCount + req.Guides.Count, BatchCount = j.BatchCount + 1 })
                    .Where(j => j.JobId == req.JobId)
                    .ExecuteCommandAsync();
            });
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "batch 插入失败: {JobId}", req.JobId);
            return false;
        }
    }

    public async Task<bool> CompleteSessionAsync(string jobId)
    {
        var current = _sessionManager.Current;
        if (current is null || current.JobId != jobId)
        {
            return false;
        }

        var batchId = current.JobId;
        try
        {
            // ★ 原子切换：单事务内删旧 + 发布新（WAL 快照隔离保证前端不读空窗）
            await _db.Ado.UseTranAsync(async () =>
            {
                // 先删旧的已发布标签与攻略
                await _db.Ado.ExecuteCommandAsync(
                    "DELETE FROM GuideTags WHERE Published = 1;");
                await _db.Ado.ExecuteCommandAsync(
                    "DELETE FROM Guides WHERE Published = 1;");
                await _db.Ado.ExecuteCommandAsync(
                    "DELETE FROM Holidays WHERE Published = 1;");

                // 发布本批次新数据
                await _db.Ado.ExecuteCommandAsync(
                    "UPDATE Guides SET Published = 1 WHERE BatchId = @bid;",
                    new { bid = batchId });
                await _db.Ado.ExecuteCommandAsync(
                    "UPDATE GuideTags SET Published = 1 WHERE BatchId = @bid;",
                    new { bid = batchId });
                await _db.Ado.ExecuteCommandAsync(
                    "UPDATE Holidays SET Published = 1 WHERE BatchId = @bid;",
                    new { bid = batchId });

                // FTS5 全量重建（自存储副本）：与批次切换同一事务，WAL 快照隔离保证读者无空窗
                await _db.Ado.ExecuteCommandAsync("DELETE FROM GuidesFts;");
                await _db.Ado.ExecuteCommandAsync(
                    """
                    INSERT INTO GuidesFts(GuideId, Published, Title, Summary, Destination, Tags)
                    SELECT Id, Published, COALESCE(Title,''), COALESCE(Summary,''),
                           COALESCE(Destination,''), COALESCE(Tags,'')
                    FROM Guides;
                    """);
            });

            // 收缩 WAL 文件
            try { await _db.Ado.ExecuteCommandAsync("PRAGMA wal_checkpoint(TRUNCATE);"); }
            catch (Exception ex) { _logger.LogWarning(ex, "wal_checkpoint 失败（可忽略）"); }

            // 清理本次切换残留的未发布孤儿数据（理论无）
            await _db.Ado.ExecuteCommandAsync("DELETE FROM Guides WHERE Published = 0;");
            await _db.Ado.ExecuteCommandAsync("DELETE FROM GuideTags WHERE Published = 0;");
            await _db.Ado.ExecuteCommandAsync("DELETE FROM Holidays WHERE Published = 0;");

            // 统计发布结果并落库（MonthKey 在 begin 时已写入，这里补条数与完成时间）
            var guideCount = await _db.Ado.SqlQueryAsync<int>("SELECT COUNT(*) FROM Guides WHERE Published = 1;");
            var holidayCount = await _db.Ado.SqlQueryAsync<int>("SELECT COUNT(*) FROM Holidays WHERE Published = 1;");
            await _db.Updateable<UpdateJob>()
                .SetColumns(j => new UpdateJob
                {
                    Status = "Complete",
                    FinishedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    GuideCount = guideCount.FirstOrDefault(),
                    HolidayCount = holidayCount.FirstOrDefault()
                })
                .Where(j => j.JobId == jobId)
                .ExecuteCommandAsync();

            _logger.LogInformation("会话 {JobId} 完成，批次 {BatchId} 已发布（攻略 {GuideCount} 条/节日 {HolidayCount} 条）",
                jobId, batchId, guideCount.FirstOrDefault(), holidayCount.FirstOrDefault());

            // 投料成功：全失效 L1 缓存，避免新批次数据被旧快照盖住（内存操作，瞬间完成）
            try { await _cache.InvalidateAllAsync(); }
            catch (Exception ex) { _logger.LogWarning(ex, "缓存失效失败（不影响数据一致性，TTL 兜底）"); }

            // 数据就绪状态刷新（读接口退出「服务器繁忙」窗口的前提之一）
            _status.SetHasData(guideCount.FirstOrDefault() > 0);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "complete 原子切换失败: {JobId}", jobId);
            return false;
        }
        finally
        {
            _status.SetUpdating(false);
            _sessionManager.Release(current);
        }
    }

    public async Task AbortSessionAsync(string jobId)
    {
        var current = _sessionManager.Current;
        if (current is null || current.JobId != jobId)
        {
            return;
        }
        try
        {
            // 删除本批次未发布数据
            await _db.Ado.ExecuteCommandAsync("DELETE FROM Guides WHERE BatchId = @bid AND Published = 0;", new { bid = jobId });
            await _db.Ado.ExecuteCommandAsync("DELETE FROM GuideTags WHERE BatchId = @bid AND Published = 0;", new { bid = jobId });
            await _db.Ado.ExecuteCommandAsync("DELETE FROM Holidays WHERE BatchId = @bid AND Published = 0;", new { bid = jobId });

            await _db.Updateable<UpdateJob>()
                .SetColumns(j => new UpdateJob { Status = "Abort", FinishedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") })
                .Where(j => j.JobId == jobId)
                .ExecuteCommandAsync();

            _logger.LogInformation("会话 {JobId} 已中止", jobId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "abort 失败: {JobId}", jobId);
        }
        finally
        {
            _status.SetUpdating(false);
            _sessionManager.Release(current);
        }
    }

    public async Task<UpdateStatusDto?> GetStatusAsync()
    {
        var current = _sessionManager.Current;

        // 上次成功发布元数据（数据库权威依据：最新一条 Complete 记录）
        var lastJob = await _db.Queryable<UpdateJob>()
            .Where(j => j.Status == "Complete")
            .OrderBy(j => j.FinishedAt, OrderByType.Desc)
            .FirstAsync();
        var guideCount = await _db.Ado.SqlQueryAsync<int>("SELECT COUNT(*) FROM Guides WHERE Published = 1;");
        var holidayCount = await _db.Ado.SqlQueryAsync<int>("SELECT COUNT(*) FROM Holidays WHERE Published = 1;");

        // 数据陈旧判定：距上次成功发布超过阈值（默认 40 天）说明漏了一期更新，空库由 Mode=maintenance 表达
        var staleThresholdDays = _config.GetValue("Update:StaleThresholdDays", 40);
        int? dataAgeDays = null;
        if (DateTime.TryParse(lastJob?.FinishedAt, out var lastPublishTime))
        {
            dataAgeDays = Math.Max(0, (int)(DateTime.Now - lastPublishTime).TotalDays);
        }

        var dto = new UpdateStatusDto
        {
            Status = "idle",
            LastMonthKey = lastJob?.MonthKey,
            LastPublishTime = lastJob?.FinishedAt,
            GuideCount = guideCount.FirstOrDefault(),
            HolidayCount = holidayCount.FirstOrDefault(),
            IsUpdating = _status.IsUpdating,
            DataAgeDays = dataAgeDays,
            IsStale = dataAgeDays.HasValue && dataAgeDays.Value > staleThresholdDays
        };

        if (current is not null)
        {
            var job = await _db.Queryable<UpdateJob>().FirstAsync(j => j.JobId == current.JobId);
            if (job is not null)
            {
                dto.JobId = job.JobId;
                dto.BatchId = job.BatchId;
                dto.Status = job.Status;
                dto.StartedAt = job.StartedAt;
                dto.InsertedCount = job.InsertedCount;
            }
        }

        dto.Mode = dto.IsUpdating ? "updating" : (dto.GuideCount == 0 ? "maintenance" : "normal");
        return dto;
    }

    /// <summary>清理超时遗留会话 + 孤儿未发布数据（begin 时调用）</summary>
    private async Task CleanupStaleSessionsAsync()
    {
        var threshold = DateTime.Now.Subtract(SessionTimeout).ToString("yyyy-MM-dd HH:mm:ss");
        var staleJobs = await _db.Queryable<UpdateJob>()
            .Where(j => j.Status == "Running" && j.StartedAt.CompareTo(threshold) < 0)
            .ToListAsync();

        foreach (var job in staleJobs)
        {
            _logger.LogWarning("清理超时遗留会话 {JobId}", job.JobId);
            await _db.Ado.ExecuteCommandAsync("DELETE FROM Guides WHERE BatchId = @bid;", new { bid = job.BatchId });
            await _db.Ado.ExecuteCommandAsync("DELETE FROM GuideTags WHERE BatchId = @bid;", new { bid = job.BatchId });
            await _db.Ado.ExecuteCommandAsync("DELETE FROM Holidays WHERE BatchId = @bid;", new { bid = job.BatchId });
            await _db.Updateable<UpdateJob>()
                .SetColumns(j => new UpdateJob { Status = "Abandoned", FinishedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") })
                .Where(j => j.JobId == job.JobId)
                .ExecuteCommandAsync();
        }

        // 兜底：删除任何 Published=0 的孤儿数据
        await _db.Ado.ExecuteCommandAsync("DELETE FROM Guides WHERE Published = 0;");
        await _db.Ado.ExecuteCommandAsync("DELETE FROM GuideTags WHERE Published = 0;");
        await _db.Ado.ExecuteCommandAsync("DELETE FROM Holidays WHERE Published = 0;");
    }
}
