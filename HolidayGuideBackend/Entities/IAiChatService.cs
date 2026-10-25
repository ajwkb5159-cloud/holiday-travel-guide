using HolidayGuideBackend.Infrastructure.Dtos;

namespace HolidayGuideBackend.Entities;

/// <summary>AI 问答请求体</summary>
public class AiChatRequest
{
    /// <summary>用户问题（≤500 字）</summary>
    public string Question { get; set; } = string.Empty;

    /// <summary>多轮上下文（前端截取最近若干条；服务端再兜底截断）</summary>
    public List<AiChatTurn>? History { get; set; }
}

public class AiChatTurn
{
    /// <summary>user | assistant</summary>
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}

/// <summary>回答中引用的站内攻略（SSE sources 事件负载，前端渲染可点击卡片）</summary>
public record AiSourceDto(int Index, int Id, string Title, string Destination, string CoverImage);

/// <summary>额度快照（GET /api/ai/quota 与 SSE done 事件共用）</summary>
public record AiQuotaDto(int Limit, int Remaining);

/// <summary>SSE 流式问答服务契约</summary>
public interface IAiChatService
{
    /// <summary>
    /// 执行 RAG 检索并代理上游 LLM，把结果以 text/event-stream 写入响应。
    /// 调用前控制器已完成 Enabled/参数/额度预检；首个增量到达后落库扣减额度。
    /// </summary>
    Task StreamChatAsync(HttpResponse response, AiChatRequest request, string clientIp, CancellationToken ct);
}

/// <summary>AI 问答每日额度服务契约（SQLite 计数，进程内单例）</summary>
public interface IAiQuotaService
{
    /// <summary>查询该 IP 今日剩余次数（含全站余量的较小值）</summary>
    Task<AiQuotaDto> GetQuotaAsync(string ip);

    /// <summary>预检：是否还有剩余额度</summary>
    Task<bool> HasQuotaAsync(string ip);

    /// <summary>消费一次额度（首个上游增量成功到达后调用；失败重试不重复计费由调用方保证只调一次）</summary>
    Task ConsumeAsync(string ip);
}
