using HolidayGuideBackend.Entities;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>
/// CodeFirst 初始化：建表 + 部分索引 + FTS5 全文索引。
/// 注意：CodeFirst 仅用于首次建表；后续 schema 变更走显式迁移脚本 + 备份。
/// FTS5 虚拟表 CodeFirst 不支持，由 IFtsSync.EnsureFtsAsync 原生 SQL 建立。
/// </summary>
public class DbInitializer : IDbInitializer
{
    private readonly ISqlSugarClient _db;
    private readonly IFtsSync _ftsSync;

    public DbInitializer(ISqlSugarClient db, IFtsSync ftsSync)
    {
        _db = db;
        _ftsSync = ftsSync;
    }

    public async Task InitAsync()
    {
        // 建表（不存在才建）
        _db.CodeFirst.InitTables<Guide>();
        _db.CodeFirst.InitTables<GuideTag>();
        _db.CodeFirst.InitTables<Holiday>();
        _db.CodeFirst.InitTables<UpdateJob>();

        // 显式迁移：老库补列（SQLite 无 IF NOT EXISTS for column，重复列报错则忽略）
        await EnsureColumnAsync("UpdateJobs", "MonthKey", "TEXT");
        await EnsureColumnAsync("UpdateJobs", "GuideCount", "INTEGER");
        await EnsureColumnAsync("UpdateJobs", "HolidayCount", "INTEGER");

        // AI 额度表（自动迁移，无需手工建表）：主键 (Day, Scope)，Scope = 'ip:x.x.x.x' | 'global'
        await _db.Ado.ExecuteCommandAsync(
            """
            CREATE TABLE IF NOT EXISTS AiQuota (
              Day TEXT NOT NULL,
              Scope TEXT NOT NULL,
              Count INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (Day, Scope)
            );
            """);

        // 老数据回填：历史 Complete 记录按发布时间推月份（发布时间 ≈ 数据月份，避免升级后首次误触发全量重推）
        try
        {
            await _db.Ado.ExecuteCommandAsync(
                "UPDATE UpdateJobs SET MonthKey = substr(FinishedAt, 1, 4) || substr(FinishedAt, 6, 2) " +
                "WHERE Status = 'Complete' AND MonthKey IS NULL AND FinishedAt IS NOT NULL AND length(FinishedAt) >= 10;");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[HolidayGuideBackend] MonthKey 回填跳过（{ex.Message}）");
        }

        // 部分索引（只索引已发布行，体积小查询快）
        await EnsureIndexAsync("IX_Guide_Pub_Destination",
            "CREATE INDEX IF NOT EXISTS IX_Guide_Pub_Destination ON Guides(Destination) WHERE Published = 1");
        await EnsureIndexAsync("IX_Guide_Pub_Season",
            "CREATE INDEX IF NOT EXISTS IX_Guide_Pub_Season ON Guides(Season) WHERE Published = 1");
        await EnsureIndexAsync("IX_Guide_Pub_HolidayDate",
            "CREATE INDEX IF NOT EXISTS IX_Guide_Pub_HolidayDate ON Guides(HolidayDate) WHERE Published = 1");
        await EnsureIndexAsync("IX_Guide_Pub_ViewCount",
            "CREATE INDEX IF NOT EXISTS IX_Guide_Pub_ViewCount ON Guides(ViewCount DESC) WHERE Published = 1");
        await EnsureIndexAsync("IX_Guide_Pub_Category",
            "CREATE INDEX IF NOT EXISTS IX_Guide_Pub_Category ON Guides(Category) WHERE Published = 1");
        await EnsureIndexAsync("IX_Guide_Pub_HolidayName",
            "CREATE INDEX IF NOT EXISTS IX_Guide_Pub_HolidayName ON Guides(HolidayName) WHERE Published = 1");
        await EnsureIndexAsync("IX_Tag_Pub_Name",
            "CREATE INDEX IF NOT EXISTS IX_Tag_Pub_Name ON GuideTags(Tag) WHERE Published = 1");
        await EnsureIndexAsync("IX_Holiday_Pub_Date",
            "CREATE INDEX IF NOT EXISTS IX_Holiday_Pub_Date ON Holidays(Date) WHERE Published = 1");

        // 索引补齐：ExternalId 全索引（断点去重在 Published=0 阶段也可能跑，不做部分索引）
        await EnsureIndexAsync("IX_Guide_ExternalId",
            "CREATE INDEX IF NOT EXISTS IX_Guide_ExternalId ON Guides(ExternalId)");
        // Region 用于目的地 region 筛选下推
        await EnsureIndexAsync("IX_Guide_Pub_Region",
            "CREATE INDEX IF NOT EXISTS IX_Guide_Pub_Region ON Guides(Region) WHERE Published = 1");

        // FTS5 全文索引（不可用时 EnsureFtsAsync 内部降级，不影响启动）
        await _ftsSync.EnsureFtsAsync();
    }

    private async Task EnsureIndexAsync(string name, string sql)
    {
        await _db.Ado.ExecuteCommandAsync(sql);
    }

    /// <summary>老库补列迁移：列已存在时 SQLite 抛 duplicate column name，捕获忽略</summary>
    private async Task EnsureColumnAsync(string table, string column, string type)
    {
        try
        {
            await _db.Ado.ExecuteCommandAsync($"ALTER TABLE {table} ADD COLUMN {column} {type};");
            Console.WriteLine($"[HolidayGuideBackend] 迁移: {table}.{column} 列已补充");
        }
        catch (Exception ex)
        {
            if (ex.Message.Contains("duplicate column", StringComparison.OrdinalIgnoreCase))
            {
                return; // 列已存在，幂等
            }
            throw;
        }
    }
}
