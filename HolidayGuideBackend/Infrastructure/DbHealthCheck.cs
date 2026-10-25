using Microsoft.Extensions.Diagnostics.HealthChecks;
using SqlSugar;

namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// SQLite 健康检查：直接对生产库执行 SELECT 1，无需引第三方 HealthChecks.Sqlite 包。
/// SqlSugarScope 单例线程安全，可直接在 health check 内复用。
/// </summary>
public class DbHealthCheck : IHealthCheck
{
    private readonly ISqlSugarClient _db;

    public DbHealthCheck(ISqlSugarClient db) => _db = db;

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var r = await _db.Ado.SqlQueryAsync<int>("SELECT 1;");
            return r.FirstOrDefault() == 1
                ? HealthCheckResult.Healthy("sqlite ok")
                : HealthCheckResult.Degraded("sqlite 返回异常");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("sqlite 不可达", ex);
        }
    }
}