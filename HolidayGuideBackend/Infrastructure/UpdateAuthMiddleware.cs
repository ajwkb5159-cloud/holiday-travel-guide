using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// 仅对 /api/update/* 生成的 token 鉴权中间件。
/// 校验请求头 X-Update-Token 是否匹配 appsettings["Update:Token"]。
/// </summary>
public class UpdateAuthMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string _expectedToken;

    public UpdateAuthMiddleware(RequestDelegate next, IConfiguration cfg)
    {
        _next = next;
        _expectedToken = cfg["Update:Token"] ?? "holiday-update-default-token";
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? string.Empty;
        if (path.StartsWith("/api/update", StringComparison.OrdinalIgnoreCase))
        {
            var token = ctx.Request.Headers["X-Update-Token"].ToString();
            if (!string.Equals(token, _expectedToken, StringComparison.Ordinal))
            {
                ctx.Response.StatusCode = 401;
                ctx.Response.ContentType = "application/json; charset=utf-8";
                await ctx.Response.WriteAsync("""{"code":401,"msg":"更新接口鉴权失败"}""");
                return;
            }
        }
        await _next(ctx);
    }
}
