using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using Microsoft.Extensions.Logging;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>攻略只读查询服务（强制 Published=1 + L1 缓存 + 聚合下推）。
/// 查询实体后内存映射 DTO，避开 SqlSugar record 表达式坑。
/// HomeAggregateAsync 不缓存 detail：ViewCount 每次详情会写，缓存会导致浏览量失计数。</summary>
public class GuideService : IGuideService
{
    private readonly ISqlSugarClient _db;
    private readonly IDestinationService _destinationService;
    private readonly ICacheInvalidator _cache;
    private readonly ILogger<GuideService> _logger;
    private int? _ftsAvailable;

    private const string Bm25Suffix = "bm25(GuidesFts, 0, 0, 3.0, 1.0, 1.5, 2.0)";

    private static readonly TimeSpan HomeTtl = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RankingTtl = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ListTtl = TimeSpan.FromSeconds(120);
    private static readonly TimeSpan SeasonalTtl = TimeSpan.FromSeconds(300);

    public GuideService(ISqlSugarClient db, IDestinationService destinationService, ICacheInvalidator cache, ILogger<GuideService> logger)
    {
        _db = db;
        _destinationService = destinationService;
        _cache = cache;
        _logger = logger;
    }

    public async Task<PagedResult<GuideListItemDto>> GetListAsync(GuideQueryDto q)
    {
        var key = $"guide:list:{q.Category ?? "*"}:{q.Destination ?? "*"}:{q.Season ?? "*"}:{q.HolidayName ?? "*"}:{q.Keyword ?? "*"}:{q.Sort ?? "*"}:{q.Page}:{q.Size}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            if (!string.IsNullOrEmpty(q.Keyword) && await UseFtsAsync())
                return await GetListByFtsAsync(q);
            return await GetListByOrmAsync(q);
        }, ListTtl);
    }

    /// <summary>无关键字 或 FTS 不可用：沿用 SqlSugar 链（LIKE 模糊 + 排序）</summary>
    private async Task<PagedResult<GuideListItemDto>> GetListByOrmAsync(GuideQueryDto q)
    {
        var query = _db.Queryable<Guide>().Where(g => g.Published == 1);
        if (!string.IsNullOrEmpty(q.Category)) query = query.Where(g => g.Category == q.Category);
        if (!string.IsNullOrEmpty(q.Destination)) query = query.Where(g => g.Destination == q.Destination);
        if (!string.IsNullOrEmpty(q.Season)) query = query.Where(g => g.Season == q.Season);
        if (!string.IsNullOrEmpty(q.HolidayName)) query = query.Where(g => g.HolidayName == q.HolidayName);
        if (!string.IsNullOrEmpty(q.Keyword))
            query = query.Where(g => g.Title.Contains(q.Keyword) || g.Summary.Contains(q.Keyword) || g.Destination.Contains(q.Keyword));

        // 排序：latest=最新发布；views=浏览数；其它含 hot=综合浏览（有 Keyword 时排序已被 bm25 接管）
        query = (q.Sort ?? "views") switch
        {
            "latest" => query.OrderByDescending(g => g.CreatedAt),
            _ => query.OrderByDescending(g => g.ViewCount)
        };

        var total = await query.CountAsync();
        var rows = await query
            .Skip((q.Page - 1) * q.Size)
            .Take(q.Size)
            .ToListAsync();
        return new PagedResult<GuideListItemDto>(rows.Select(ToListItem).ToList(), total, q.Page, q.Size);
    }

    /// <summary>有 Keyword 且 FTS 可用：MATCH + 其余 filter 下推 WHERE + bm25 排序 + 精确 count</summary>
    private async Task<PagedResult<GuideListItemDto>> GetListByFtsAsync(GuideQueryDto q)
    {
        var match = BuildMatch(q.Keyword!);
        if (match.Length == 0) return new PagedResult<GuideListItemDto>(new List<GuideListItemDto>(), 0, q.Page, q.Size);

        var off = (q.Page - 1) * q.Size;
        var total = (await _db.Ado.SqlQueryAsync<long>(
            $$"""
            SELECT COUNT(*) FROM GuidesFts f JOIN Guides g ON g.Id = f.GuideId
            WHERE GuidesFts MATCH '{{match}}' AND f.Published = 1
              AND (@cat IS NULL OR g.Category = @cat)
              AND (@dest IS NULL OR g.Destination = @dest)
              AND (@season IS NULL OR g.Season = @season)
              AND (@holi IS NULL OR g.HolidayName = @holi);
            """, new { cat = q.Category, dest = q.Destination, season = q.Season, holi = q.HolidayName })).FirstOrDefault();

        var rows = await _db.Ado.SqlQueryAsync<Guide>(
            $$"""
            SELECT g.Id, g.Title, g.Summary, g.Content, g.CoverImage, g.Destination, g.Region,
                   g.Season, g.HolidayName, g.HolidayDate, g.Days, g.Category, g.Tags,
                   g.ViewCount, g.ExternalId, g.Published, g.BatchId, g.CreatedAt
            FROM GuidesFts f JOIN Guides g ON g.Id = f.GuideId
            WHERE GuidesFts MATCH '{{match}}' AND f.Published = 1
              AND (@cat IS NULL OR g.Category = @cat)
              AND (@dest IS NULL OR g.Destination = @dest)
              AND (@season IS NULL OR g.Season = @season)
              AND (@holi IS NULL OR g.HolidayName = @holi)
            ORDER BY {{Bm25Suffix}}
            LIMIT @size OFFSET @off;
            """, new { cat = q.Category, dest = q.Destination, season = q.Season, holi = q.HolidayName, size = q.Size, off });

        return new PagedResult<GuideListItemDto>(rows.Select(ToListItem).ToList(), (int)total, q.Page, q.Size);
    }

    private async Task<bool> UseFtsAsync()
    {
        if (_ftsAvailable.HasValue) return _ftsAvailable.Value == 1;
        try
        {
            var n = (await _db.Ado.SqlQueryAsync<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='GuidesFts';")).FirstOrDefault();
            _ftsAvailable = n > 0 ? 1 : 0;
        }
        catch (Exception ex) { _logger.LogWarning(ex, "FTS5 探测失败，列表关键词降级 LIKE"); _ftsAvailable = 0; }
        return _ftsAvailable.Value == 1;
    }

    private static string BuildMatch(string q)
    {
        var tokens = q.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(t => t.Trim('"', '*', ':', '(', ')', '^', '\''))
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => '"' + t.Replace("\"", "\"\"") + '"')
            .ToList();
        return tokens.Count == 0 ? string.Empty : string.Join(" OR ", tokens);
    }

    public async Task<GuideDetailDto?> GetDetailAsync(int id)
    {
        var g = await _db.Queryable<Guide>()
            .Where(x => x.Id == id && x.Published == 1)
            .FirstAsync();
        if (g is null) return null;

        // 浏览量 +1（轻量场景直接更新；高并发可改内存累计）。不缓存详情避免失计数
        await _db.Updateable<Guide>()
            .SetColumns(x => new Guide { ViewCount = x.ViewCount + 1 })
            .Where(x => x.Id == id)
            .ExecuteCommandAsync();

        var tagList = (g.Tags ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries).ToList();

        var relatedDto = await GetRelatedAsync(g);

        return new GuideDetailDto(
            g.Id, g.Title, g.Summary ?? string.Empty, g.Content ?? string.Empty, g.CoverImage ?? string.Empty,
            g.Destination, g.Region ?? string.Empty, g.Season ?? string.Empty, g.HolidayName ?? string.Empty,
            g.HolidayDate ?? string.Empty, g.Days, g.Category ?? string.Empty, g.Tags ?? string.Empty, g.ViewCount,
            g.CreatedAt, tagList, relatedDto);
    }

    public async Task<List<GuideListItemDto>> GetRankingAsync(string type, int limit)
    {
        var key = $"guide:ranking:{type}:{limit}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            if (type == "latest")
            {
                var rows = await _db.Queryable<Guide>()
                    .Where(g => g.Published == 1)
                    .OrderByDescending(g => g.CreatedAt)
                    .Take(limit).ToListAsync();
                return rows.Select(ToListItem).ToList();
            }

            // hot_raw：纯累计 ViewCount（降级备选）；hot（默认）：HN 时间衰减，让新攻略有机会出头
            if (type == "hot_raw")
            {
                var rows = await _db.Queryable<Guide>()
                    .Where(g => g.Published == 1)
                    .OrderByDescending(g => g.ViewCount)
                    .Take(limit).ToListAsync();
                return rows.Select(ToListItem).ToList();
            }

            // 默认 hot：HN 衰减 score = (ViewCount+2) / (ageHours+2)^1.5
            // julianday 计算年龄小时；CreatedAt 是 yyyy-MM-dd HH:mm:ss 可被 julianday 解析
            var decayed = await _db.Ado.SqlQueryAsync<Guide>(
                """
                SELECT g.* FROM Guides g
                WHERE g.Published = 1
                ORDER BY (g.ViewCount * 1.0 + 2.0) / power(
                    (julianday('now') - julianday(g.CreatedAt)) * 24.0 + 2.0, 1.5) DESC,
                    g.ViewCount DESC
                LIMIT @limit;
                """, new { limit });
            return decayed.Select(ToListItem).ToList();
        }, RankingTtl);
    }

    public async Task<List<GuideListItemDto>> GetSeasonalAsync(string season, int limit)
    {
        var key = $"guide:seasonal:{season}:{limit}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            var rows = await _db.Queryable<Guide>()
                .Where(g => g.Published == 1 && g.Season == season)
                .OrderByDescending(g => g.ViewCount)
                .Take(limit)
                .ToListAsync();
            return rows.Select(ToListItem).ToList();
        }, SeasonalTtl);
    }

    public async Task<HomeAggregateDto> GetHomeAggregateAsync()
    {
        return await _cache.GetOrCreateAsync("guide:home", async () =>
        {
            // 倒计时窗口 90 天：覆盖最长节日空档，避免“下一个节日只差一天却被 60 天窗口挡住”
            var today = DateTime.Now.ToString("yyyy-MM-dd");
            var future = DateTime.Now.Date.AddDays(90).ToString("yyyy-MM-dd");
            var holidays = await _db.Queryable<Holiday>()
                .Where(h => h.Published == 1
                            && h.Date.CompareTo(today) >= 0
                            && h.Date.CompareTo(future) <= 0)
                .OrderBy(h => h.Date)
                .Take(6)
                .ToListAsync();

            var countdowns = holidays.Select(h => new HolidayCountdownDto(
                h.Name, h.Date, CalcDaysLeft(h.Date), h.Type ?? string.Empty, h.CoverImage ?? string.Empty)).ToList();

            var season = CurrentSeason();
            var seasonal = await GetSeasonalAsync(season, 6);
            var hot = await GetRankingAsync("hot", 8);

            // 热门目的地：下推 GROUP BY Destination + COUNT（取代原全表 ToList 内存聚合）
            var hotDest = await _destinationService.GetTopAsync(null, null, 8);

            // 临近节日攻略：取最早一个未来节日，推该节日高浏览攻略（激活闲置的 HolidayDate/HolidayName 维度）
            var nearestHolidayName = holidays.Count > 0 ? holidays[0].Name : string.Empty;
            var nearestGuides = new List<GuideListItemDto>();
            if (!string.IsNullOrEmpty(nearestHolidayName))
            {
                var ng = await _db.Queryable<Guide>()
                    .Where(g => g.Published == 1 && g.HolidayName == nearestHolidayName)
                    .OrderByDescending(g => g.ViewCount)
                    .Take(6)
                    .ToListAsync();
                nearestGuides = ng.Select(ToListItem).ToList();
            }

            return new HomeAggregateDto(countdowns, seasonal, hot, hotDest, nearestGuides);
        }, HomeTtl);
    }

    public static string CurrentSeason()
    {
        var m = DateTime.Now.Month;
        return m switch
        {
            >= 3 and <= 5 => "spring",
            >= 6 and <= 8 => "summer",
            >= 9 and <= 11 => "autumn",
            _ => "winter"
        };
    }

    /// <summary>
    /// 个性化推荐打分（120 条量级全表内存算分足够快，结果缓存 120s）。
    /// score = 目的地命中×2.0 + 分类命中×1.2 + 标签命中数×1.0 + 当季×0.2 + log10(ViewCount+1)×0.3 + 日盐打散×0.05。
    /// 全空参数退化为热门榜语义（仅热度+当季+日盐），保证鲁棒。
    /// </summary>
    public async Task<List<GuideListItemDto>> GetRecommendAsync(RecommendQuery q)
    {
        var limit = Math.Clamp(q.Limit, 1, 20);
        var dests = NormSet(q.Destinations);
        var cats = NormSet(q.Categories);
        var tags = NormSet(q.Tags);
        var excludes = q.ExcludeIds?.ToHashSet() ?? [];
        var season = CurrentSeason();
        var salt = DateTime.Now.DayOfYear.ToString();

        var key = $"guide:recommend:{string.Join('|', dests)}:{string.Join('|', cats)}:{string.Join('|', tags)}:{string.Join('|', excludes.OrderBy(x => x))}:{limit}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            // 只取打分所需列，避免拉 Content 大字段
            var rows = await _db.Queryable<Guide>()
                .Where(g => g.Published == 1)
                .Select(g => new Guide
                {
                    Id = g.Id, Title = g.Title, Summary = g.Summary, CoverImage = g.CoverImage,
                    Destination = g.Destination, Season = g.Season, HolidayName = g.HolidayName,
                    Days = g.Days, Tags = g.Tags, ViewCount = g.ViewCount, Category = g.Category
                })
                .ToListAsync();

            return rows
                .Where(g => !excludes.Contains(g.Id))
                .Select(g =>
                {
                    double s = 0;
                    if (dests.Count > 0 && dests.Contains(g.Destination)) s += 2.0;
                    if (cats.Count > 0 && cats.Contains(g.Category ?? "")) s += 1.2;
                    if (tags.Count > 0)
                    {
                        var guideTags = (g.Tags ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                        s += guideTags.Count(tags.Contains) * 1.0;
                    }
                    if (g.Season == season) s += 0.2;
                    s += Math.Log10(g.ViewCount + 1) * 0.3;
                    s += Math.Abs(Infrastructure.ClientIpResolver.StableHash($"g{g.Id}", salt)) % 100 / 100.0 * 0.05;
                    return (g, s);
                })
                .OrderByDescending(x => x.s)
                .ThenByDescending(x => x.g.ViewCount)
                .Take(limit)
                .Select(x => ToListItem(x.g))
                .ToList();
        }, TimeSpan.FromSeconds(120));
    }

    private static HashSet<string> NormSet(List<string>? input) =>
        (input ?? [])
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s.Trim())
            .Take(12)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// 相关攻略推荐：基于 GuideTags 的 Jaccard 标签相似度取 Top5。
    /// 0-标签攻略或候选不足时回退同 Destination + ViewCount DESC（沿用原策略）。
    /// GuideTags 量小（每标签 40-120 行），内存算交集/并集足够快。
    /// </summary>
    private async Task<List<GuideListItemDto>> GetRelatedAsync(Guide self)
    {
        var selfTags = (await _db.Queryable<GuideTag>()
            .Where(t => t.GuideId == self.Id && t.Published == 1)
            .Select(t => t.Tag)
            .ToListAsync()).ToHashSet();

        if (selfTags.Count == 0)
            return await RelatedByDestinationAsync(self);

        // 候选：与自己共享至少一个标签的其它攻略的 (GuideId, Tag)
        var candidates = await _db.Queryable<GuideTag>()
            .Where(t => t.Published == 1 && t.GuideId != self.Id && selfTags.Contains(t.Tag))
            .Select(t => new { t.GuideId, t.Tag })
            .ToListAsync();

        // 按攻略分组聚合标签集合
        var tagGroups = candidates
            .GroupBy(c => c.GuideId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Tag).ToHashSet());

        if (tagGroups.Count == 0)
            return await RelatedByDestinationAsync(self);

        // 候选攻略的 ViewCount 用于 tiebreak 与后续加载详情列
        var candidateIds = tagGroups.Keys.ToList();
        var guides = await _db.Queryable<Guide>()
            .Where(g => g.Published == 1 && candidateIds.Contains(g.Id))
            .ToListAsync();
        var guideMap = guides.ToDictionary(g => g.Id);

        // Jaccard = |A∩B| / |A∪B|，tiebreak：ViewCount DESC
        var scored = tagGroups
            .Where(kv => guideMap.ContainsKey(kv.Key))
            .Select(kv =>
            {
                var inter = kv.Value.Count(t => selfTags.Contains(t));
                var uni = selfTags.Count + kv.Value.Count - inter;
                var j = uni > 0 ? (double)inter / uni : 0;
                return (Guide: guideMap[kv.Key], J: j);
            })
            .OrderByDescending(x => x.J)
            .ThenByDescending(x => x.Guide.ViewCount)
            .Take(5)
            .ToList();

        // 相似度命中数不足 5 时用同目的地补齐
        if (scored.Count < 5)
        {
            var have = scored.Select(s => s.Guide.Id).ToHashSet();
            var fill = (await _db.Queryable<Guide>()
                .Where(x => x.Published == 1 && x.Destination == self.Destination && x.Id != self.Id)
                .OrderByDescending(x => x.ViewCount)
                .Take(5 - scored.Count)
                .ToListAsync())
                .Where(g => !have.Contains(g.Id));
            scored.AddRange(fill.Select(g => (g, 0.0)));
        }

        return scored.Select(s => ToListItem(s.Guide)).ToList();
    }

    /// <summary>回退推荐：同目的地 + 浏览量降序</summary>
    private async Task<List<GuideListItemDto>> RelatedByDestinationAsync(Guide self)
    {
        var rows = await _db.Queryable<Guide>()
            .Where(x => x.Published == 1 && x.Destination == self.Destination && x.Id != self.Id)
            .OrderByDescending(x => x.ViewCount)
            .Take(5)
            .ToListAsync();
        return rows.Select(ToListItem).ToList();
    }

    private static GuideListItemDto ToListItem(Guide g) => new(
        g.Id, g.Title, g.Summary ?? string.Empty, g.CoverImage ?? string.Empty,
        g.Destination, g.Season ?? string.Empty, g.HolidayName ?? string.Empty,
        g.Days, g.Tags ?? string.Empty, g.ViewCount, g.Category ?? string.Empty);

    private static int CalcDaysLeft(string dateStr)
    {
        if (DateTime.TryParse(dateStr, out var d))
        {
            return Math.Max(0, (int)(d.Date - DateTime.Now.Date).TotalDays);
        }
        return 0;
    }
}