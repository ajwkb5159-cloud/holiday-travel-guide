using HolidayGuideBackend.BLL;
using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace HolidayGuideBackend.Controllers;

/// <summary>
/// AI 行程规划助手（无鉴权读接口，受 ServiceGateMiddleware 纳管：更新窗口内 503）。
/// chat 为 SSE 流式响应；额度按 IP 每日限次（AiOptions.DailyIpQuota），全局日上限兜底。
/// Ai:Enabled=false 时 chat 返回 501，前端据此隐藏悬浮球入口。
/// </summary>
[ApiController]
[Route("api/ai")]
public class AiController : ControllerBase
{
    private const int MaxQuestionLength = 500;

    private readonly IAiChatService _ai;
    private readonly IAiQuotaService _quota;
    private readonly AiConcurrencyGate _gate;
    private readonly AiOptions _opts;
    private readonly ILogger<AiController> _logger;

    public AiController(IAiChatService ai, IAiQuotaService quota, AiConcurrencyGate gate,
        IOptions<AiOptions> options, ILogger<AiController> logger)
    {
        _ai = ai; _quota = quota; _gate = gate; _opts = options.Value; _logger = logger;
    }

    /// <summary>前端悬浮球挂载探测：enabled=false 时整个组件不渲染</summary>
    [HttpGet("status")]
    public IActionResult Status() => Ok(ApiResult<object>.Ok(new { Enabled = _opts.Enabled }));

    /// <summary>今日剩余咨询次数（角标展示用；AI 关闭时也返回，Enabled 字段区分）</summary>
    [HttpGet("quota")]
    public async Task<IActionResult> Quota()
    {
        var ip = ClientIpResolver.Resolve(HttpContext);
        var quota = await _quota.GetQuotaAsync(ip);
        return Ok(ApiResult<object>.Ok(new { _opts.Enabled, quota.Limit, quota.Remaining, quota.Unlimited }));
    }

    /// <summary>SSE 流式问答。请求体 {Question, History?}；事件 delta/sources/done/error</summary>
    [HttpPost("chat")]
    public async Task Chat([FromBody] AiChatRequest request)
    {
        // AI 关闭 → 501（非 SSE JSON，前端隐藏入口的依据之一）
        if (!_opts.Enabled)
        {
            Response.StatusCode = StatusCodes.Status501NotImplemented;
            Response.ContentType = "application/json; charset=utf-8";
            await Response.WriteAsync("""{"code":501,"msg":"AI 功能未开启","data":null}""");
            return;
        }

        var question = (request?.Question ?? string.Empty).Trim();
        if (question.Length == 0)
        {
            Response.StatusCode = StatusCodes.Status400BadRequest;
            Response.ContentType = "application/json; charset=utf-8";
            await Response.WriteAsync("""{"code":400,"msg":"问题不能为空","data":null}""");
            return;
        }
        if (question.Length > MaxQuestionLength)
        {
            question = question[..MaxQuestionLength];
        }

        // 额度预检：超限 429（非 SSE JSON，body 带剩余额度）
        var ip = ClientIpResolver.Resolve(HttpContext);
        if (!await _quota.HasQuotaAsync(ip))
        {
            _logger.LogInformation("AI 额度用尽 ip={Ip}", ip);
            Response.StatusCode = StatusCodes.Status429TooManyRequests;
            Response.ContentType = "application/json; charset=utf-8";
            await Response.WriteAsync("""{"code":429,"msg":"今日免费咨询次数已用完，明天再来吧","data":{"Limit":0,"Remaining":0}}""");
            return;
        }

        // 并发闸排队（10s）：挤不进去返回 429「当前咨询人数较多」
        IDisposable lease;
        try
        {
            lease = await _gate.AcquireAsync(TimeSpan.FromSeconds(10), HttpContext.RequestAborted);
        }
        catch (AiConcurrencyGate.AiBusyException)
        {
            _logger.LogWarning("AI 并发闸排队超时 ip={Ip}", ip);
            Response.StatusCode = StatusCodes.Status429TooManyRequests;
            Response.ContentType = "application/json; charset=utf-8";
            await Response.WriteAsync("""{"code":429,"msg":"当前咨询人数较多，请稍后再试","data":null}""");
            return;
        }

        try
        {
            await _ai.StreamChatAsync(Response, new AiChatRequest { Question = question, History = request?.History }, ip, HttpContext.RequestAborted);
        }
        finally
        {
            lease.Dispose();
        }
    }
}
