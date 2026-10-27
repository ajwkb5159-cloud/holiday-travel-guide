using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.Extensions.Options;

namespace HolidayGuideBackend.BLL;

/// <summary>
/// AI 行程规划助手：站内攻略 RAG 检索 + OpenAI 兼容流式代理 + SSE 输出。
/// 流程：FTS/LIKE 检索 TopK 攻略注入 system prompt → 上游 stream=true 增量透传（event:delta）→
/// 结束前把答案中的 [n] 引用映射回攻略发 sources 事件 → done 事件带剩余额度。
/// 额度在首个正文增量成功到达后才扣减（连接失败/超时/仅推理 chunk 不计费）。
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

    /// <summary>
    /// Key 解析链：配置显式值 → ApiKeyFile → OPENCODE_* 环境变量。
    /// 不再保留 DashScope 回退，避免旧 key 被误发给 OpenCode。
    /// </summary>
    private string ResolveApiKey()
    {
        if (!string.IsNullOrWhiteSpace(_opts.ApiKey)) return _opts.ApiKey.Trim();

        var fromConfiguredFile = ReadKeyFile(_opts.ApiKeyFile);
        if (fromConfiguredFile.Length > 0) return fromConfiguredFile;

        foreach (var name in new[] { "OPENCODE_API_KEY_FILE", "OPENCODE_GO_API_KEY", "OPENCODE_API_KEY" })
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (string.IsNullOrWhiteSpace(value)) continue;
            if (name.EndsWith("_FILE", StringComparison.Ordinal))
            {
                var fromEnvFile = ReadKeyFile(value);
                if (fromEnvFile.Length > 0) return fromEnvFile;
            }
            else
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    private static string ReadKeyFile(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return string.Empty;
        try
        {
            if (!File.Exists(path)) return string.Empty;
            return File.ReadAllText(path).Trim();
        }
        catch
        {
            return string.Empty;
        }
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
        var reasoning = new StringBuilder();
        var consumed = false;
        try
        {
            using var upstreamCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            upstreamCts.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(_opts.TimeoutSeconds, 30, 600)));

            var apiKey = ResolveApiKey();
            if (apiKey.Length == 0)
            {
                await WriteEventAsync(response, "error", new { Message = "AI 服务未配置密钥，请联系站长" }, ct);
                return;
            }

            var messages = BuildMessages(question, history, retrieved);
            var body = new Dictionary<string, object?>
            {
                ["model"] = _opts.Model,
                ["messages"] = messages,
                ["stream"] = true,
                ["temperature"] = _opts.Temperature,
                ["max_tokens"] = _opts.MaxTokens
            };
            MergeExtraBody(body);

            var client = _httpFactory.CreateClient(HttpClientName);
            using var req = new HttpRequestMessage(HttpMethod.Post, _opts.BaseURL)
            {
                Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            req.Headers.Accept.ParseAdd("text/event-stream");
            // OpenCode Go 要求客户端标识 + 稳定会话头（用于路由与 prompt 缓存）
            req.Headers.UserAgent.ParseAdd("HolidayTravelGuide/1.0");
            if (_opts.BaseURL.Contains("opencode.ai", StringComparison.OrdinalIgnoreCase))
            {
                var sessionId = string.IsNullOrWhiteSpace(_opts.SessionId)
                    ? "hg-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(clientIp)))[..16].ToLowerInvariant()
                    : _opts.SessionId.Trim();
                req.Headers.TryAddWithoutValidation("x-opencode-session", sessionId);
            }

            using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, upstreamCts.Token);
            if (!resp.IsSuccessStatusCode)
            {
                var errorBody = await SafeReadAsync(resp);
                _logger.LogWarning("上游 LLM {Status} body={Body}", (int)resp.StatusCode, errorBody[..Math.Min(errorBody.Length, 300)]);
                var message = (int)resp.StatusCode switch
                {
                    401 or 403 => "AI 服务鉴权失败，请联系站长",
                    429 => "AI 服务繁忙，请稍后再试",
                    _ => "AI 服务暂时不可用，请稍后再试"
                };
                await WriteEventAsync(response, "error", new { Message = message }, ct);
                return;
            }

            // 有些兼容端点会忽略 stream=true，直接返回 application/json；这里做一次回退。
            var mediaType = resp.Content.Headers.ContentType?.MediaType;
            if (!string.Equals(mediaType, "text/event-stream", StringComparison.OrdinalIgnoreCase))
            {
                var jsonBody = await resp.Content.ReadAsStringAsync(upstreamCts.Token);
                await HandleJsonFallbackAsync(response, jsonBody, answer, clientIp, retrieved, consumed, ct);
                return;
            }

            using var stream = await resp.Content.ReadAsStreamAsync(upstreamCts.Token);
            using var reader = new StreamReader(stream);
            string? finishReason = null;
            while (true)
            {
                var line = await reader.ReadLineAsync(upstreamCts.Token);
                if (line is null) break;
                if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;

                var payload = line[5..].Trim();
                if (payload == "[DONE]") break;
                if (payload.Length == 0) continue;

                try
                {
                    using var doc = JsonDocument.Parse(payload);
                    var root = doc.RootElement;
                    if (!root.TryGetProperty("choices", out var choices) ||
                        choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() == 0)
                    {
                        continue; // usage-only / 空 choices chunk，跳过即可
                    }

                    var choice = choices[0];
                    if (choice.TryGetProperty("finish_reason", out var fr) && fr.ValueKind == JsonValueKind.String)
                    {
                        finishReason = fr.GetString();
                    }
                    if (!choice.TryGetProperty("delta", out var deltaObj) || deltaObj.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    var reasoningDelta = deltaObj.TryGetProperty("reasoning_content", out var rc) && rc.ValueKind == JsonValueKind.String
                        ? rc.GetString() : null;
                    if (!string.IsNullOrEmpty(reasoningDelta))
                    {
                        reasoning.Append(reasoningDelta);
                        if (_opts.SendReasoningContent)
                        {
                            await WriteEventAsync(response, "reasoning", new { Text = reasoningDelta }, ct);
                        }
                    }

                    var delta = deltaObj.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String
                        ? c.GetString() : null;
                    if (string.IsNullOrEmpty(delta)) continue;

                    if (!consumed)
                    {
                        // 首个正文增量到达才计费；仅推理 chunk/连接失败不计费
                        consumed = true;
                        await _quota.ConsumeAsync(clientIp);
                    }
                    answer.Append(delta);
                    await WriteEventAsync(response, "delta", new { Text = delta }, ct);
                }
                catch (JsonException)
                {
                    // 单行坏数据跳过即可
                }
            }

            if (answer.Length == 0)
            {
                var message = finishReason == "length"
                    ? "回答被截断，请重试"
                    : "AI 没有返回内容，请换个问法试试";
                await WriteEventAsync(response, "error", new { Message = message }, ct);
                return;
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

    /// <summary>非 SSE 的 200 JSON 回退：解析 choices[0].message.content，按单条 delta 输出。</summary>
    private async Task HandleJsonFallbackAsync(HttpResponse response, string body, StringBuilder answer,
        string clientIp, List<Guide> retrieved, bool consumed, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (!root.TryGetProperty("choices", out var choices) ||
                choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() == 0)
            {
                await WriteEventAsync(response, "error", new { Message = "AI 服务返回了空内容" }, ct);
                return;
            }

            var message = choices[0].TryGetProperty("message", out var m) ? m : default;
            var content = message.ValueKind == JsonValueKind.Object &&
                          message.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String
                ? c.GetString() : null;
            var reasoning = message.ValueKind == JsonValueKind.Object &&
                            message.TryGetProperty("reasoning_content", out var r) && r.ValueKind == JsonValueKind.String
                ? r.GetString() : null;

            if (!string.IsNullOrEmpty(reasoning) && _opts.SendReasoningContent)
                await WriteEventAsync(response, "reasoning", new { Text = reasoning }, ct);

            if (string.IsNullOrEmpty(content))
            {
                await WriteEventAsync(response, "error", new { Message = "AI 没有返回内容，请换个问法试试" }, ct);
                return;
            }

            if (!consumed) await _quota.ConsumeAsync(clientIp);
            answer.Append(content);
            await WriteEventAsync(response, "delta", new { Text = content }, ct);

            var sources = ExtractSources(content, retrieved);
            if (sources.Count > 0) await WriteEventAsync(response, "sources", sources, ct);
            var quota = await _quota.GetQuotaAsync(clientIp);
            await WriteEventAsync(response, "done", quota, ct);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "上游返回了非 SSE 且非 JSON 的响应");
            await WriteEventAsync(response, "error", new { Message = "AI 服务返回格式异常" }, ct);
        }
    }

    private void MergeExtraBody(Dictionary<string, object?> body)
    {
        if (string.IsNullOrWhiteSpace(_opts.ExtraBodyJson)) return;
        try
        {
            using var doc = JsonDocument.Parse(_opts.ExtraBodyJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return;
            foreach (var property in doc.RootElement.EnumerateObject())
            {
                body[property.Name] = JsonSerializer.Deserialize<object>(property.Value.GetRawText());
            }
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Ai:ExtraBodyJson 解析失败，已忽略");
        }
    }

    /// <summary>
    /// 上下文清洗：保留 user/assistant，按配置限制条数/总字符/单条字符。
    /// 默认 500 条、150 万字符（约 1M tokens），真正把 1M 上下文用起来。
    /// </summary>
    private List<(string Role, string Content, string? Reasoning)> SanitizeHistory(List<AiChatTurn>? history)
    {
        if (history is null || history.Count == 0) return [];

        var maxTurns = Math.Clamp(_opts.HistoryMaxTurns, 2, 2000);
        var maxChars = Math.Clamp(_opts.HistoryMaxChars, 1000, 4_000_000);
        var perMessage = Math.Clamp(_opts.HistoryPerMessageChars, 500, 200_000);

        var turns = history
            .Where(h => h is not null &&
                        (h.Role is "user" or "assistant") &&
                        !string.IsNullOrWhiteSpace(h.Content))
            .TakeLast(maxTurns)
            .Select(h => (
                h.Role,
                Content: h.Content.Trim(),
                Reasoning: string.IsNullOrWhiteSpace(h.ReasoningContent) ? null : h.ReasoningContent.Trim()))
            .Select(t => (
                t.Role,
                Content: t.Content.Length > perMessage ? t.Content[..perMessage] : t.Content,
                Reasoning: t.Reasoning != null && t.Reasoning.Length > perMessage ? t.Reasoning[..perMessage] : t.Reasoning))
            .ToList();

        // 从最旧的一条开始丢弃，直到总字符预算内；至少保留最近一条
        var total = turns.Sum(t => t.Content.Length + (t.Reasoning?.Length ?? 0));
        while (turns.Count > 1 && total > maxChars)
        {
            var first = turns[0];
            total -= first.Content.Length + (first.Reasoning?.Length ?? 0);
            turns.RemoveAt(0);
        }
        return turns;
    }

    private List<object> BuildMessages(string question,
        List<(string Role, string Content, string? Reasoning)> history, List<Guide> retrieved)
    {
        var messages = new List<object> { new { role = "system", content = SystemPrompt } };
        foreach (var (role, content, reasoning) in history)
        {
            if (_opts.SendReasoningContent && role == "assistant")
            {
                // 即使没有捕获到推理内容也带上字段（空串），满足要求该字段存在的 provider
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = role,
                    ["content"] = content,
                    ["reasoning_content"] = reasoning ?? string.Empty
                });
            }
            else
            {
                messages.Add(new { role, content });
            }
        }

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
