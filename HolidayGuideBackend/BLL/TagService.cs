using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using Microsoft.Extensions.Caching.Memory;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>标签云服务（GROUP BY + ORDER BY + Take 全下推 SQL + L1 缓存）</summary>
public class TagService : ITagService
{
    private readonly ISqlSugarClient _db;
    private readonly ICacheInvalidator _cache;
    private static readonly TimeSpan CloudTtl = TimeSpan.FromSeconds(300);

    public TagService(ISqlSugarClient db, ICacheInvalidator cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<List<TagCountDto>> GetTagsAsync(int limit)
    {
        var key = $"tag:cloud:{limit}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            var raw = await _db.Queryable<GuideTag>()
                .Where(t => t.Published == 1)
                .GroupBy(t => t.Tag)
                .Select(t => new
                {
                    Tag = t.Tag,
                    Count = SqlFunc.AggregateCount(t.Id)
                })
                .MergeTable() // 把 GROUP BY 结果包成派生表，使 OrderBy 走在聚合后的列上、Take 下推 SQL
                .OrderBy("Count DESC")
                .Take(limit)
                .ToListAsync();
            return raw.Select(x => new TagCountDto(x.Tag, x.Count)).ToList();
        }, CloudTtl);
    }
}