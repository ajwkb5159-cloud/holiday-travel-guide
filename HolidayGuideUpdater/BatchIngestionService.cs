using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace HolidayGuideUpdater;

/// <summary>
/// 月度数据入库编排：begin → 分批 batch（组间 delay）→ complete 原子切换。
/// 断点续传：state.json 记录进度；后端会话失效则重新 begin 全量重发。
/// 全程顺序 await 绝不并发，避免后端写锁竞争。
/// </summary>
public class BatchIngestionService(
    IHttpClientFactory httpClientFactory,
    StateStore stateStore,
    GuideDataSource dataSource,
    IConfiguration config,
    ILogger<BatchIngestionService> logger)
{
    private readonly IHttpClientFactory _httpClientFactory = httpClientFactory;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private HttpClient Http => _httpClientFactory.CreateClient("backend");

    public async Task RunAsync(string monthKey, CancellationToken ct)
    {
        var dataDir = config["Updater:DataDir"] ?? "data";
        var batchSize = config.GetValue("Updater:BatchSize", 150);
        var batchDelayMs = config.GetValue("Updater:BatchDelayMs", 800);
        var maxRetries = config.GetValue("Updater:MaxRetries", 3);
        var retryBaseDelayMs = config.GetValue("Updater:RetryBaseDelayMs", 1000);

        var doc = dataSource.Load(monthKey, dataDir);
        var batches = doc.Guides.Chunk(batchSize).ToList();

        var state = stateStore.Load();
        string jobId;
        int resumeFrom;

        // 断点续传：仅当同月同会话且后端确认仍在 Running 时续传，否则重新 begin
        if (state.Status == "uploading" && state.MonthKey == monthKey)
        {
            var st = await GetStatusAsync(ct);
            if (st is { Data.JobId: not null } && st.Data.JobId == state.JobId && st.Data.Status == "Running")
            {
                jobId = state.JobId;
                resumeFrom = state.LastBatchIndex + 1;
                logger.LogInformation("断点续传: 会话存活, 从批次 {Index}/{Total} 继续", resumeFrom, batches.Count);
            }
            else
            {
                jobId = await BeginWithRetryAsync(monthKey, ct);
                resumeFrom = 0;
                logger.LogWarning("后端会话已失效, 重新 begin 从批次 0 全量重发");
            }
        }
        else
        {
            jobId = await BeginWithRetryAsync(monthKey, ct);
            resumeFrom = 0;
        }

        state.MonthKey = monthKey;
        state.Status = "uploading";
        state.JobId = jobId;
        state.TotalBatches = batches.Count;
        state.StartedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        state.LastError = "";
        stateStore.Save(state);

        try
        {
            for (var i = resumeFrom; i < batches.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                var payload = new BatchPayload
                {
                    JobId = jobId,
                    BatchId = jobId,
                    Guides = batches[i].ToList(),
                    Holidays = i == 0 ? doc.Holidays : null, // holidays 只能随批次 0 发一次，否则后端重复插入
                };
                await PostBatchWithRetryAsync(payload, maxRetries, retryBaseDelayMs, ct);

                state.LastBatchIndex = i;
                stateStore.Save(state);
                logger.LogInformation("批次 {Index}/{Total} 完成 ({Count} 条)", i, batches.Count, batches[i].Length);

                if (i < batches.Count - 1)
                {
                    await Task.Delay(batchDelayMs, ct); // 组间 delay 缓冲，宁可慢不可干死数据库
                }
            }

            await PostCompleteWithRetryAsync(jobId, maxRetries, retryBaseDelayMs, ct);
            state.Status = "completed";
            state.JobId = "";
            state.LastBatchIndex = -1;
            stateStore.Save(state);
            logger.LogInformation("月度更新完成: {MonthKey}, 共 {Total} 批 {Count} 条", monthKey, batches.Count, doc.Guides.Count);
        }
        catch (Exception ex)
        {
            await TryAbortAsync(jobId, ct);
            state.Status = "failed";
            state.LastError = ex.Message;
            stateStore.Save(state);
            throw;
        }
    }

    /// <summary>begin：409（已有会话）等 BeginRetryDelaySec 重试；全败抛异常放弃本次</summary>
    private async Task<string> BeginWithRetryAsync(string monthKey, CancellationToken ct)
    {
        var retryCount = config.GetValue("Updater:BeginRetryCount", 3);
        var retryDelaySec = config.GetValue("Updater:BeginRetryDelaySec", 30);

        for (var attempt = 1; ; attempt++)
        {
            var resp = await Http.PostAsJsonAsync("api/update/begin", new { monthKey }, ct);
            if (resp.StatusCode == HttpStatusCode.OK)
            {
                var result = await resp.Content.ReadFromJsonAsync<ApiResult<BeginData>>(cancellationToken: ct);
                if (result is { Code: 0, Data.JobId: not null })
                {
                    logger.LogInformation("begin 成功: {JobId} (month={MonthKey})", result.Data.JobId, monthKey);
                    return result.Data.JobId;
                }
            }

            var hint = resp.StatusCode == HttpStatusCode.Conflict ? "已有更新会话在运行" : $"HTTP {(int)resp.StatusCode}";
            if (attempt >= retryCount)
            {
                throw new InvalidOperationException($"begin 失败 {retryCount} 次（{hint}），放弃本次更新");
            }
            logger.LogWarning("{Hint}, {Delay} 秒后重试 ({Attempt}/{Max})", hint, retryDelaySec, attempt, retryCount);
            await Task.Delay(TimeSpan.FromSeconds(retryDelaySec), ct);
        }
    }

    private async Task PostBatchWithRetryAsync(BatchPayload payload, int maxRetries, int baseDelayMs, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var resp = await Http.PostAsJsonAsync("api/update/batch", payload, ct);
            if (resp.StatusCode == HttpStatusCode.OK)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                var result = JsonSerializer.Deserialize<ApiResult<object>>(body, JsonOptions);
                if (result?.Code == 0) return;
            }

            if (attempt >= maxRetries)
            {
                throw new InvalidOperationException($"batch 重试 {maxRetries} 次仍失败, HTTP {(int)resp.StatusCode}");
            }
            var delayMs = baseDelayMs * Math.Pow(3, attempt - 1); // 指数退避 1s/3s/9s
            logger.LogWarning("batch 失败, {Delay}ms 后重试 ({Attempt}/{Max})", delayMs, attempt, maxRetries);
            await Task.Delay(TimeSpan.FromMilliseconds(delayMs), ct);
        }
    }

    private async Task PostCompleteWithRetryAsync(string jobId, int maxRetries, int baseDelayMs, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var resp = await Http.PostAsJsonAsync("api/update/complete", new { jobId }, ct);
            if (resp.StatusCode == HttpStatusCode.OK) return;
            if (attempt >= maxRetries)
            {
                throw new InvalidOperationException($"complete 重试 {maxRetries} 次仍失败, HTTP {(int)resp.StatusCode}");
            }
            await Task.Delay(TimeSpan.FromMilliseconds(baseDelayMs * Math.Pow(3, attempt - 1)), ct);
        }
    }

    /// <summary>查询后端会话状态（断点续传判定用）</summary>
    private async Task<ApiResult<UpdateStatusData>?> GetStatusAsync(CancellationToken ct)
    {
        try
        {
            var resp = await Http.GetAsync("api/update/status", ct);
            if (!resp.IsSuccessStatusCode) return null;
            return await resp.Content.ReadFromJsonAsync<ApiResult<UpdateStatusData>>(JsonOptions, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "查询会话状态失败");
            return null;
        }
    }

    /// <summary>后端服务状态快照（补跑判定用；失败返回 null 不抛，调用方跳过本轮）</summary>
    public async Task<BackendStatusInfo?> GetBackendStatusAsync(CancellationToken ct)
    {
        try
        {
            var resp = await Http.GetAsync("api/update/status", ct);
            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("查询后端状态失败: HTTP {(Status)}", (int)resp.StatusCode);
                return null;
            }
            var result = await resp.Content.ReadFromJsonAsync<ApiResult<UpdateStatusData>>(JsonOptions, ct);
            if (result is not { Data: not null })
            {
                return null;
            }
            return new BackendStatusInfo
            {
                Status = result.Data.Status,
                JobId = result.Data.JobId,
                IsUpdating = result.Data.IsUpdating,
                LastMonthKey = result.Data.LastMonthKey,
                LastPublishTime = result.Data.LastPublishTime,
                GuideCount = result.Data.GuideCount ?? 0,
                HolidayCount = result.Data.HolidayCount ?? 0
            };
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "查询后端状态异常");
            return null;
        }
    }

    private async Task TryAbortAsync(string jobId, CancellationToken ct)
    {
        try
        {
            await Http.PostAsJsonAsync("api/update/abort", new { jobId }, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "abort 调用失败(可忽略)");
        }
    }

    private class ApiResult<T>
    {
        public int Code { get; set; }
        public string Msg { get; set; } = "";
        public T? Data { get; set; }
    }

    private class BeginData
    {
        public string? JobId { get; set; }
    }

    private class UpdateStatusData
    {
        public string? JobId { get; set; }
        public string? Status { get; set; }
        public bool IsUpdating { get; set; }
        public string? LastMonthKey { get; set; }
        public string? LastPublishTime { get; set; }
        public int? GuideCount { get; set; }
        public int? HolidayCount { get; set; }
    }

    private class BatchPayload
    {
        public string JobId { get; set; } = "";
        public string BatchId { get; set; } = "";
        public List<GuideItem> Guides { get; set; } = new();
        public List<HolidayItem>? Holidays { get; set; }
    }
}

/// <summary>后端服务状态快照（补跑判定用）</summary>
public class BackendStatusInfo
{
    public string? Status { get; set; }
    public string? JobId { get; set; }
    public bool IsUpdating { get; set; }
    public string? LastMonthKey { get; set; }
    public string? LastPublishTime { get; set; }
    public int GuideCount { get; set; }
    public int HolidayCount { get; set; }
}
