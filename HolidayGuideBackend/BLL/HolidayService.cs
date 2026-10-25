using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using Microsoft.Extensions.Caching.Memory;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>节日/倒计时服务（CompareTo 下推命中 IX_Holiday_Pub_Date + L1 缓存）</summary>
public class HolidayService : IHolidayService
{
    private readonly ISqlSugarClient _db;
    private readonly ICacheInvalidator _cache;

    // 缓存 key 与 TTL 集中管理，方便投料 complete 全失效核对
    private static readonly TimeSpan CountdownTtl = TimeSpan.FromSeconds(300);
    private static readonly TimeSpan ListTtl = TimeSpan.FromSeconds(300);

    public HolidayService(ISqlSugarClient db, ICacheInvalidator cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<List<HolidayCountdownDto>> GetCountdownAsync(int days)
    {
        var key = $"holiday:countdown:{days}";
        return await _cache.GetOrCreateAsync(key, async () =>
        {
            // Date 是固定长度 yyyy-MM-dd 字符串，字典序==日期序，CompareTo 可下推命中索引
            var today = DateTime.Now.ToString("yyyy-MM-dd");
            var future = DateTime.Now.Date.AddDays(days).ToString("yyyy-MM-dd");
            var rows = await _db.Queryable<Holiday>()
                .Where(h => h.Published == 1
                            && h.Date.CompareTo(today) >= 0
                            && h.Date.CompareTo(future) <= 0)
                .OrderBy(h => h.Date)
                .ToListAsync();
            return rows.Select(h => new HolidayCountdownDto(
                h.Name, h.Date, CalcDaysLeft(h.Date), h.Type, h.CoverImage)).ToList();
        }, CountdownTtl);
    }

    public async Task<List<HolidayDto>> GetListAsync()
    {
        return await _cache.GetOrCreateAsync("holiday:list", async () =>
        {
            var rows = await _db.Queryable<Holiday>()
                .Where(h => h.Published == 1)
                .OrderBy(h => h.Date)
                .ToListAsync();
            return rows.Select(h => new HolidayDto(
                h.Id, h.Name, h.Date, h.Type ?? string.Empty, h.IsLegal,
                h.Description ?? string.Empty, h.CoverImage ?? string.Empty)).ToList();
        }, ListTtl);
    }

    private static int CalcDaysLeft(string dateStr)
    {
        if (DateTime.TryParse(dateStr, out var d))
            return Math.Max(0, (int)(d.Date - DateTime.Now.Date).TotalDays);
        return 0;
    }
}