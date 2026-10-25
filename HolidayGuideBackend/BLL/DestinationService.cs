using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using Microsoft.Extensions.Caching.Memory;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>目的地聚合查询服务（GROUP BY + COUNT 下推 SQL + L1 缓存）</summary>
public class DestinationService : IDestinationService
{
    private readonly ISqlSugarClient _db;
    private readonly ICacheInvalidator _cache;
    private static readonly TimeSpan ListTtl = TimeSpan.FromSeconds(300);
    private static readonly TimeSpan DetailTtl = TimeSpan.FromSeconds(300);

    public DestinationService(ISqlSugarClient db, ICacheInvalidator cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<List<DestinationDto>> GetListAsync(string? region, string? season, int limit)
        => await GetTopAsync(region, season, limit);

    /// <summary>首页热门目的地复用（GuideService 注入调用）</summary>
    public async Task<List<DestinationDto>> GetTopAsync(string? region, string? season, int limit)
    {
        var key = $"destination:list:{region ?? "*"}:{season ?? "*"}:{limit}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            var raw = await _db.Queryable<Guide>()
                .Where(g => g.Published == 1)
                .WhereIF(!string.IsNullOrEmpty(region), g => g.Region == region)
                .WhereIF(!string.IsNullOrEmpty(season), g => g.Season == season)
                .GroupBy(g => new { g.Destination, g.Region })
                .Select(g => new
                {
                    Destination = g.Destination,
                    Region = g.Region,
                    GuideCount = SqlFunc.AggregateCount(g.Id),
                    CoverImage = SqlFunc.AggregateMax(g.CoverImage)
                })
                .MergeTable()
                .OrderBy("GuideCount DESC")
                .Take(limit)
                .ToListAsync();
            // 投匿名再内存构造 record DTO，避开 SqlSugar record 表达式映射坑
            return raw.Select(x => new DestinationDto(
                x.Destination ?? string.Empty,
                x.Region ?? string.Empty,
                x.GuideCount,
                x.CoverImage ?? string.Empty)).ToList();
        }, ListTtl);
    }

    public async Task<DestinationDetailDto?> GetDetailAsync(string name)
    {
        var key = $"destination:detail:{name}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            var all = await _db.Queryable<Guide>()
                .Where(g => g.Published == 1 && g.Destination == name)
                .ToListAsync();
            if (all.Count == 0) return null;

            var guides = all
                .OrderByDescending(g => g.ViewCount)
                .Take(20)
                .Select(ToListItem)
                .ToList();

            var region = all[0].Region ?? string.Empty;
            return new DestinationDetailDto(name, region, all.Count, guides);
        }, DetailTtl);
    }

    private static GuideListItemDto ToListItem(Guide g) => new(
        g.Id, g.Title, g.Summary ?? string.Empty, g.CoverImage ?? string.Empty,
        g.Destination, g.Season ?? string.Empty, g.HolidayName ?? string.Empty,
        g.Days, g.Tags ?? string.Empty, g.ViewCount, g.Category ?? string.Empty);
}