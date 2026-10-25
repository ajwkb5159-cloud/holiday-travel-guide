using SqlSugar;

namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// SqlSugar + SQLite 配置：WAL 模式、busy_timeout、部分索引友好。
/// SqlSugarScope 线程安全，注册为 Singleton。
/// </summary>
public static class SqlSugarSetup
{
    public static void AddSqlSugar(this IServiceCollection services, IConfiguration cfg)
    {
        var dbPath = cfg.GetConnectionString("SQLite")
            ?? throw new InvalidOperationException("未配置 SQLite 连接串");

        // 解析相对路径到绝对路径（基于后端 exe 所在目录）
        if (!Path.IsPathRooted(dbPath))
        {
            dbPath = Path.Combine(AppContext.BaseDirectory, dbPath);
        }

        var dir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var connStr = $"Data Source={dbPath};Mode=ReadWriteCreate";

        var sqlSugar = new SqlSugarScope(new ConnectionConfig
        {
            ConnectionString = connStr,
            DbType = DbType.Sqlite,
            IsAutoCloseConnection = true,
            InitKeyType = InitKeyType.Attribute,
            MoreSettings = new ConnMoreSettings
            {
                SqliteCodeFirstEnableDefaultValue = true
            }
        },
        db =>
        {
            // 每个连接首次使用时执行的 PRAGMA
            db.Ado.ExecuteCommand("PRAGMA journal_mode=WAL;");
            db.Ado.ExecuteCommand("PRAGMA synchronous=NORMAL;");
            db.Ado.ExecuteCommand("PRAGMA busy_timeout=15000;");
            db.Ado.ExecuteCommand("PRAGMA cache_size=-20000;");
            db.Ado.ExecuteCommand("PRAGMA wal_autocheckpoint=1000;");
            db.Ado.ExecuteCommand("PRAGMA temp_store=MEMORY;");
        });

        services.AddSingleton<ISqlSugarClient>(sqlSugar);
    }
}
