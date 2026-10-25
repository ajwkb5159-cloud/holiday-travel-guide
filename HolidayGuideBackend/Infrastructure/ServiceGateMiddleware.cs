using Microsoft.Extensions.Configuration;

namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// 读接口服务门：更新会话进行中（IsUpdating）或库内无已发布数据（!HasData）时，
/// 对只读 /api 接口统一返回 503「服务器繁忙，请稍后重试」。
/// 放行：/api/update/*（更新流程本身）、/api/system/*（状态轮询）、/health（探活）。
/// 静态文件与 SPA fallback 不受影响（注册在 UseStaticFiles 之后），页面可加载、由前端遮罩提示。
/// 配置开关：Update:BusyDuringUpdate / Update:BusyWhenEmpty（false = 逃生门，更新期间照常读旧数据）。
/// </summary>
public class ServiceGateMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ServiceStatus _status;
    private readonly bool _busyDuringUpdate;
    private readonly bool _busyWhenEmpty;

    public ServiceGateMiddleware(RequestDelegate next, ServiceStatus status, IConfiguration cfg)
    {
        _next = next;
        _status = status;
        _busyDuringUpdate = cfg.GetValue("Update:BusyDuringUpdate", true);
        _busyWhenEmpty = cfg.GetValue("Update:BusyWhenEmpty", true);
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? string.Empty;
        var isReadApi = path.StartsWith("/api", StringComparison.OrdinalIgnoreCase)
            && !path.StartsWith("/api/update", StringComparison.OrdinalIgnoreCase)
            && !path.StartsWith("/api/system", StringComparison.OrdinalIgnoreCase);
        if (!isReadApi || ctx.Request.Method == "OPTIONS")
        {
            await _next(ctx);
            return;
        }

        var busy = (_status.IsUpdating && _busyDuringUpdate) || (!_status.HasData && _busyWhenEmpty);
        if (busy)
        {
            ctx.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            await ctx.Response.WriteAsync("""{"code":503,"msg":"服务器繁忙，请稍后重试"}""");
            return;
        }

        await _next(ctx);
    }
}
