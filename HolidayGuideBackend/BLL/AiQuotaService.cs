using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.Extensions.Options;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>
/// AI 问答每日额度（SQLite AiQuota 表，主键 (Day, Scope)）。
/// Scope = "ip:x.x.x.x" 或 "global"。读写均为单行 upsert/查询，WAL 下开销可忽略。
/// 过期行（保留 7 天）惰性清理：每天首个请求顺带执行一次 DELETE，避免常驻进程表膨胀。
/// Ai:QuotaEnabled=false（默认）时完全不计数、不限次，仅保留接口兼容。
/// </summary>
public class AiQuotaService : IAiQuotaService
{
    private readonly ISqlSugarClient _db;
    private readonly ILogger<AiQuotaService> _logger;
    private readonly bool _quotaEnabled;
    private readonly int _ipLimit;
    private readonly int _globalCap;
    private long _lastCleanupDay;

    public AiQuotaService(ISqlSugarClient db, IOptions<AiOptions> options, ILogger<AiQuotaService> logger)
    {
        _db = db;
        _logger = logger;
        _quotaEnabled = options.Value.QuotaEnabled;
        _ipLimit = Math.Max(1, options.Value.DailyIpQuota);
        _globalCap = Math.Max(_ipLimit, options.Value.GlobalDailyCap);
    }

    private static string Today() => DateTime.Now.ToString("yyyy-MM-dd");

    private async Task<(int IpCount, int GlobalCount)> GetCountsAsync(string ip)
    {
        var day = Today();
        var rows = await _db.Ado.SqlQueryAsync<string>(
            "SELECT Scope || '=' || Count FROM AiQuota WHERE Day = @day AND (Scope = @s1 OR Scope = @s2);",
            new { day, s1 = ScopeOf(ip), s2 = "global" });
        int ipCount = 0, globalCount = 0;
        foreach (var raw in rows)
        {
            var eq = raw.LastIndexOf('=');
            if (eq <= 0) continue;
            var count = int.TryParse(raw[(eq + 1)..], out var c) ? c : 0;
            if (raw.StartsWith("global")) globalCount = count;
            else ipCount = count;
        }
        return (ipCount, globalCount);
    }

    public async Task<AiQuotaDto> GetQuotaAsync(string ip)
    {
        if (!_quotaEnabled) return new AiQuotaDto(-1, -1, true);
        await CleanupIfNeededAsync();
        var (ipCount, globalCount) = await GetCountsAsync(ip);
        var remaining = Math.Max(0, Math.Min(_ipLimit - ipCount, _globalCap - globalCount));
        return new AiQuotaDto(_ipLimit, remaining);
    }

    public async Task<bool> HasQuotaAsync(string ip)
    {
        if (!_quotaEnabled) return true;
        return (await GetQuotaAsync(ip)).Remaining > 0;
    }

    public async Task ConsumeAsync(string ip)
    {
        if (!_quotaEnabled) return;
        var day = Today();
        try
        {
            // SQLite ≥3.35 支持 upsert；两行各自原子自增。预检已挡住超限流量，
            // 极端并发下的少量越界由 GlobalDailyCap 兜底语义吸收，无需事务锁行。
            await _db.Ado.ExecuteCommandAsync(
                """
                INSERT INTO AiQuota(Day, Scope, Count) VALUES(@day, @scope, 1)
                ON CONFLICT(Day, Scope) DO UPDATE SET Count = Count + 1;
                """, new { day, scope = ScopeOf(ip) });
            await _db.Ado.ExecuteCommandAsync(
                """
                INSERT INTO AiQuota(Day, Scope, Count) VALUES(@day, 'global', 1)
                ON CONFLICT(Day, Scope) DO UPDATE SET Count = Count + 1;
                """, new { day });
        }
        catch (Exception ex)
        {
            // 计数失败不阻断对话（宁可少计不可误伤），仅记日志
            _logger.LogWarning(ex, "AI 额度计数写入失败 ip={Ip}", ip);
        }
    }

    /// <summary>惰性清理：进程生命周期内每个自然日最多执行一次</summary>
    private async Task CleanupIfNeededAsync()
    {
        var todayTicks = DateTime.Now.Date.Ticks;
        var last = Interlocked.Read(ref _lastCleanupDay);
        if (last == todayTicks) return;
        if (Interlocked.CompareExchange(ref _lastCleanupDay, todayTicks, last) != last) return;

        try
        {
            var cutoff = DateTime.Now.Date.AddDays(-7).ToString("yyyy-MM-dd");
            await _db.Ado.ExecuteCommandAsync("DELETE FROM AiQuota WHERE Day < @cutoff;", new { cutoff });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AiQuota 过期行清理失败");
        }
    }

    private static string ScopeOf(string ip) => "ip:" + ip;
}
