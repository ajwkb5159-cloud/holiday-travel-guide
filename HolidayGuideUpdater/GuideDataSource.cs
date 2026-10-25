using System.Text.Json;

namespace HolidayGuideUpdater;

/// <summary>攻略条目（与后端 GuideItem 同构；大小写不敏感反序列化，兼容 camelCase 数据文件）</summary>
public class GuideItem
{
    public string ExternalId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public string Content { get; set; } = "";
    public string CoverImage { get; set; } = "";
    public string Destination { get; set; } = "";
    public string Region { get; set; } = "";
    public string Season { get; set; } = "";
    public string HolidayName { get; set; } = "";
    public string HolidayDate { get; set; } = "";
    public int Days { get; set; }
    public string Category { get; set; } = "";
    public List<string> Tags { get; set; } = new();
}

/// <summary>节日条目（与后端 HolidayItem 同构）</summary>
public class HolidayItem
{
    public string Name { get; set; } = "";
    public string Date { get; set; } = "";
    public string Type { get; set; } = "";
    public int IsLegal { get; set; }
    public string Description { get; set; } = "";
    public string CoverImage { get; set; } = "";
}

/// <summary>月度数据文件根节点（guides[] + holidays[]）</summary>
public class GuideBatchDocument
{
    public List<GuideItem> Guides { get; set; } = new();
    public List<HolidayItem> Holidays { get; set; } = new();
}

/// <summary>读取本地月度数据文件 data/{yyyyMM}/guides.json（可回退 data/latest/）</summary>
public class GuideDataSource(ILogger<GuideDataSource> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public GuideBatchDocument Load(string monthKey, string dataDir)
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, dataDir, monthKey, "guides.json"),
            Path.Combine(AppContext.BaseDirectory, dataDir, "latest", "guides.json"),
        };

        foreach (var path in candidates)
        {
            if (File.Exists(path))
            {
                var doc = JsonSerializer.Deserialize<GuideBatchDocument>(File.ReadAllText(path), JsonOptions)
                          ?? new GuideBatchDocument();
                logger.LogInformation("数据文件加载成功: {Path}, 攻略 {GuideCount} 条, 节日 {HolidayCount} 条",
                    path, doc.Guides.Count, doc.Holidays.Count);
                return doc;
            }
        }

        throw new FileNotFoundException($"未找到 {monthKey} 月数据文件，已尝试: {string.Join("; ", candidates)}");
    }

    /// <summary>指定月份是否有数据文件（调度判定用）</summary>
    public bool HasData(string monthKey, string dataDir)
        => File.Exists(Path.Combine(AppContext.BaseDirectory, dataDir, monthKey, "guides.json"))
        || File.Exists(Path.Combine(AppContext.BaseDirectory, dataDir, "latest", "guides.json"));

    /// <summary>
    /// 数据目录中最新的月份（yyyyMM）：扫描 data/*/ 下 d{6} 目录且含 guides.json 的取最大月。
    /// 无月份目录时回退 data/latest/guides.json（无月份语义，按当前月视为最新）。
    /// 用于服务重启后的补跑判定：库内已发布月份 &lt; 该值 → 需要系统性数据更新。
    /// </summary>
    public string? FindNewestMonth(string dataDir)
    {
        var baseDir = Path.Combine(AppContext.BaseDirectory, dataDir);
        string? newest = null;
        if (Directory.Exists(baseDir))
        {
            foreach (var dir in Directory.EnumerateDirectories(baseDir))
            {
                var name = Path.GetFileName(dir);
                if (name.Length == 6 && name.All(char.IsDigit) && File.Exists(Path.Combine(dir, "guides.json")))
                {
                    if (newest is null || string.CompareOrdinal(name, newest) > 0)
                    {
                        newest = name;
                    }
                }
            }
        }
        if (newest is null && File.Exists(Path.Combine(baseDir, "latest", "guides.json")))
        {
            newest = DateTime.Now.ToString("yyyyMM");
            logger.LogInformation("无月份目录数据，回退 data/latest 按当前月 {MonthKey} 视为最新", newest);
        }
        return newest;
    }
}
