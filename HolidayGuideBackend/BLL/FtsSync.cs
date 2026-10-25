using HolidayGuideBackend.Infrastructure;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>
/// FTS5 全文索引同步：自存储副本模式（不用外部内容+触发器，规避 complete 批次切换的触发器竞态）。
/// complete 事务内全量重建，与 WAL 快照隔离保持一致：读者在事务提交前看旧快照、之后看新快照，无空窗。
/// </summary>
public interface IFtsSync
{
    Task EnsureFtsAsync();
    Task RebuildAsync();
}

public class FtsSync : IFtsSync
{
    private readonly ISqlSugarClient _db;
    private readonly ILogger<FtsSync> _logger;

    public FtsSync(ISqlSugarClient db, ILogger<FtsSync> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task EnsureFtsAsync()
    {
        try
        {
            await _db.Ado.ExecuteCommandAsync(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS GuidesFts USING fts5(
                    GuideId UNINDEXED,
                    Published UNINDEXED,
                    Title, Summary, Destination, Tags,
                    tokenize = 'unicode61');
                """);
            // 幂等回填：FTS 行数=0 才全量灌
            var ftsCount = (await _db.Ado.SqlQueryAsync<long>("SELECT COUNT(*) FROM GuidesFts")).FirstOrDefault();
            if (ftsCount == 0)
            {
                await RebuildAsync();
                // 重建后再取一次计数，日志应反映真实回填行数（此前打印的是回填前恒为 0 的计数）
                var afterCount = (await _db.Ado.SqlQueryAsync<long>("SELECT COUNT(*) FROM GuidesFts")).FirstOrDefault();
                _logger.LogInformation("FTS5 初始化完成，已回填 {Count} 行", afterCount);
            }
        }
        catch (Exception ex)
        {
            // 环境未编译 FTS5 时降级：Search/GetList 回退 LIKE 路径（见 SearchService._ftsAvailable）
            _logger.LogWarning(ex, "FTS5 建表/回填失败，搜索将降级为 LIKE 模糊匹配");
        }
    }

    /// <summary>表是否存在（避免 complete 在 FTS5 不可用时整体回滚批次切换）</summary>
    private async Task<bool> TableExistsAsync()
    {
        try
        {
            var n = (await _db.Ado.SqlQueryAsync<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='GuidesFts';")).FirstOrDefault();
            return n > 0;
        }
        catch { return false; }
    }

    public async Task RebuildAsync()
    {
        if (!await TableExistsAsync()) return; // FTS5 不可用：跳过，保留 Guides 已发布状态，下次启动 EnsureFtsAsync 兜底
        // 自存储副本：镜像整张 Guides（含 Published=0），读取时 WHERE Published=1 过滤
        await _db.Ado.ExecuteCommandAsync("DELETE FROM GuidesFts;");
        await _db.Ado.ExecuteCommandAsync(
            """
            INSERT INTO GuidesFts(GuideId, Published, Title, Summary, Destination, Tags)
            SELECT Id, Published,
                   COALESCE(Title,''), COALESCE(Summary,''),
                   COALESCE(Destination,''), COALESCE(Tags,'')
            FROM Guides;
            """);
    }
}