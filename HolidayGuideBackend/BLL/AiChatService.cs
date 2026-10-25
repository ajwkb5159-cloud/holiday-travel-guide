using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.Extensions.Options;

namespace HolidayGuideBackend.BLL;

/// <summary>
/// AI 行程规划助手：站内攻略 RAG 检索 + DashScope(OpenAI 兼容) 流式代理 + SSE 输出。
/// 流程：FTS/LIKE 检索 TopK 攻略注入 system prompt → 上游 stream=true 增量透传（event:delta）→
/// 结束前把答案中的 [n] 引用映射回攻略发 sources 事件 → done 事件带剩余额度。
/// 额度在首个上游增量成功到达后才扣减（连接失败/超时不计费）。
/// </summary>
public partial class AiChatService : IAiChatService
{
    public const string HttpClientName = "ai-upstream";

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = null };

    private readonly ISearchService _search;
    private readonly IAiQuotaService _quota;
    private readonly IHttpClientFactory _httpFactory;
    private readonly AiOptions _opts;
    private readonly ILogger<AiChatService> _logger;

    private const string SystemPrompt =
        "你是「节假日旅游攻略」网站的 AI 行程规划师。请严格遵守：" +
        "1.优先依据【站内攻略资料】回答，引用某条攻略的具体信息时在该句末尾标注编号如 [1]、[2]，编号只允许使用资料中出现的。" +
        "2.资料未覆盖的内容可用通用旅行常识补充，但需注明「通用建议」。" +
        "3.用户询问行程时按天分块给出安排（上午/下午/晚上），附交通与餐饮提示。" +
        "4.用简体中文，语气亲切专业，总长度控制在 600 字以内；不确定就说不确定，不要编造景点、价格与班次。" +
        "5.不要使用 markdown 标题/表格/图片语法，用换行和序号组织内容。";

    public AiChatService(ISearchService search, IAiQuotaService quota,
        IHttpClientFactory httpFactory, IOptions<AiOptions> options, ILogger<AiChatService> logger)
    {
        _search = search; _quota = quota; _httpFactory = httpFactory;
        _opts = options.Value; _logger = logger;
    }

    /// <summary>ApiKey 解析链：配置显式值 → 环境变量 DASHSCOPE_API_KEY → ~/.dashscope.key</summary>
    private string ResolveApiKey()
    {
        if (!string.IsNullOrWhiteSpace(_opts.ApiKey)) return _opts.ApiKey.Trim();
        var env = Environment.GetEnvironmentVariable("DASHSCOPE_API_KEY");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
        var keyFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dashscope.key");
        if (File.Exists(keyFile))
        {
            var k = File.ReadAllText(keyFile).Trim();
            if (k.Length > 0) return k;
        }
        return string.Empty;
    }

    public async Task StreamChatAsync(HttpResponse response, AiChatRequest request, string clientIp, CancellationToken ct)
    {
        var question = request.Question.Trim();
        var history = SanitizeHistory(request.History);

        // ---- RAG 检索（复用搜索降级链路；失败不阻断对话，退化为无资料通用回答）----
        List<Guide> retrieved = new();
        try
        {
            retrieved = await _search.RetrieveForRagAsync(question, Math.Clamp(_opts.RetrieveTopK, 1, 10));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AI RAG 检索失败，按无资料回答");
        }

        // ---- SSE 头部：此后所有异常都走 error 事件，保证前端单一解析路径 ----
        response.StatusCode = 200;
        response.ContentType = "text/event-stream; charset=utf-8";
        response.Headers["Cache-Control"] = "no-cache";
        response.Headers["X-Accel-Buffering"] = "no";

        var answer = new StringBuilder();
        var consumed = false;
        try
        {
            using var upstreamCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            upstreamCts.CancelAfter(TimeSpan.FromSeconds(120));

            var apiKey = ResolveApiKey();
            if (apiKey.Length == 0)
            {
                await WriteEventAsync(response, "error", new { Message = "AI 服务未配置密钥，请联系站长" }, ct);
                return;
            }

            var messages = BuildMessages(question, history, retrieved);
            var client = _httpFactory.CreateClient(HttpClientName);
            using var req = new HttpRequestMessage(HttpMethod.Post, _opts.BaseURL);
            req.Content = new StringContent(JsonSerializer.Serialize(new
            {
                model = _opts.Model,
                messages,
                stream = true,
                temperature = 0.7,
                max_tokens = 1500
            }), Encoding.UTF8, "application/json");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, upstreamCts.Token);
            if (!resp.IsSuccessStatusCode)
            {
                var body = await SafeReadAsync(resp);
                _logger.LogWarning("上游 LLM {Status} body={Body}", (int)resp.StatusCode, body[..Math.Min(body.Length, 300)]);
                await WriteEventAsync(response, "error",
                    new { Message = (int)resp.StatusCode == 429 ? "AI 服务繁忙，请稍后再试" : "AI 服务暂时不可用，请稍后再试" }, ct);
                return;
            }

            using var stream = await resp.Content.ReadAsStreamAsync(upstreamCts.Token);
            using var reader = new StreamReader(stream);
            while (true)
            {
                var line = await reader.ReadLineAsync(upstreamCts.Token);
                if (line is null) break;
                if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;

                var payload = line[5..].Trim();
                if (payload == "[DONE]") break;

                string? delta = null;
                try
                {
                    using var doc = JsonDocument.Parse(payload);
                    delta = doc.RootElement.GetProperty("choices")[0]
                        .GetProperty("delta").TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String
                        ? c.GetString()
                        : null;
                }
                catch (JsonException)
                {
                    // 单行坏数据跳过即可
                }

                if (string.IsNullOrEmpty(delta)) continue;
                if (!consumed)
                {
                    // 首个增量到达才计费；后续增量不再重复调用
                    consumed = true;
                    await _quota.ConsumeAsync(clientIp);
                }
                answer.Append(delta);
                await WriteEventAsync(response, "delta", new { Text = delta }, ct);
            }

            // 引用映射：答案中的 [n] → 站内攻略卡片
            var sources = ExtractSources(answer.ToString(), retrieved);
            if (sources.Count > 0)
                await WriteEventAsync(response, "sources", sources, ct);

            var quota = await _quota.GetQuotaAsync(clientIp);
            await WriteEventAsync(response, "done", quota, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // 客户端提前断开（关面板/刷新页）：正常现象，仅记 Debug 级
            _logger.LogDebug("AI 对话客户端断开 ip={Ip}", clientIp);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AI 对话流式转发失败 ip={Ip}", clientIp);
            try
            {
                var msg = answer.Length == 0 ? "AI 服务暂时不可用，请稍后再试" : "回答中断了，请重新提问";
                await WriteEventAsync(response, "error", new { Message = msg }, CancellationToken.None);
            }
            catch { /* 连接已死，忽略 */ }
        }
    }

    /// <summary>上下文清洗：仅保留 user/assistant 角色、最近 6 条、单条截断 1000 字</summary>
    private static List<(string Role, string Content)> SanitizeHistory(List<AiChatTurn>? history)
    {
        if (history is null || history.Count == 0) return [];
        return history
            .Where(h => h is not null &&
                        (h.Role is "user" or "assistant") &&
                        !string.IsNullOrWhiteSpace(h.Content))
            .Select(h => (h.Role, Content: h.Content.Trim()))
            .TakeLast(6)
            .Select(t => (t.Role, Content: t.Content.Length > 1000 ? t.Content[..1000] : t.Content))
            .ToList();
    }

    private List<object> BuildMessages(string question, List<(string Role, string Content)> history, List<Guide> retrieved)
    {
        var messages = new List<object> { new { role = "system", content = SystemPrompt } };
        foreach (var (role, content) in history)
            messages.Add(new { role, content });

        var user = new StringBuilder();
        if (retrieved.Count > 0)
        {
            user.AppendLine("【站内攻略资料】");
            for (var i = 0; i < retrieved.Count; i++)
            {
                var g = retrieved[i];
                user.AppendLine($"[{i + 1}] 《{g.Title}》目的地：{g.Destination}｜天数：{g.Days} 天" +
                                (string.IsNullOrEmpty(g.Tags) ? "" : $"｜标签：{g.Tags}"));
                if (!string.IsNullOrEmpty(g.Summary)) user.AppendLine($"摘要：{g.Summary}");
                var excerpt = TruncateForPrompt(g.Content ?? string.Empty, 800);
                if (excerpt.Length > 0) user.AppendLine($"正文节选：{excerpt}");
                user.AppendLine();
            }
            user.AppendLine("【用户问题】");
            user.Append(question);
        }
        else
        {
            // 无命中：明确要求模型声明是通用建议（计划约定文案）
            user.Append("【用户问题】").AppendLine(question)
                .Append("（注：本次未检索到相关站内攻略，请在回答开头注明「以下为通用建议，非站内攻略」。）");
        }
        messages.Add(new { role = "user", content = user.ToString() });
        return messages;
    }

    /// <summary>[n] 引用映射回检索结果；非法编号与重复项剔除</summary>
    private static List<AiSourceDto> ExtractSources(string answerText, List<Guide> retrieved)
    {
        if (retrieved.Count == 0) return [];
        var seen = new HashSet<int>();
        var result = new List<AiSourceDto>();
        foreach (var m in CitationRegex().Matches(answerText))
        {
            var match = (Match)m;
            if (!int.TryParse(match.Groups[1].Value, out var n)) continue;
            if (n < 1 || n > retrieved.Count || !seen.Add(n)) continue;
            var g = retrieved[n - 1];
            result.Add(new AiSourceDto(n, g.Id, g.Title, g.Destination, g.CoverImage));
        }
        return result.OrderBy(s => s.Index).ToList();
    }

    /// <summary>HTML 正文 → 纯文本节选（去标签/实体/折叠空白），避免污染 prompt</summary>
    private static string TruncateForPrompt(string html, int maxChars)
    {
        if (string.IsNullOrEmpty(html)) return string.Empty;
        var text = TagRegex().Replace(html, " ");
        text = System.Net.WebUtility.HtmlDecode(text);
        text = SpaceRegex().Replace(text, " ").Trim();
        return text.Length <= maxChars ? text : text[..maxChars] + "…";
    }

    private static async Task<string> SafeReadAsync(HttpResponseMessage resp)
    {
        try { return await resp.Content.ReadAsStringAsync(); }
        catch { return string.Empty; }
    }

    /// <summary>SSE 事件帧：event 名 + JSON 负载（JSON 字符串化保证换行安全）</summary>
    private static async Task WriteEventAsync(HttpResponse response, string evt, object data, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(data, JsonOpts);
        await response.WriteAsync($"event: {evt}\ndata: {json}\n\n", Encoding.UTF8, ct);
        await response.Body.FlushAsync(ct);
    }

    [GeneratedRegex(@"\[(\d{1,2})\]")]
    private static partial Regex CitationRegex();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex TagRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex SpaceRegex();
}
