using Microsoft.Extensions.Options;

namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// 上游 LLM 并发闸：限制同时出站的 LLM 请求数（省服务器性能 + 控上游 QPS）。
/// 进程内单例 SemaphoreSlim；排队等待超过阈值抛 AiBusyException → 429「当前咨询人数较多」。
/// </summary>
public class AiConcurrencyGate
{
    public sealed class AiBusyException : Exception
    {
        public AiBusyException() : base("当前咨询人数较多，请稍后再试") { }
    }

    private sealed class Releaser(AiConcurrencyGate gate) : IDisposable
    {
        public void Dispose() => gate._sem.Release();
    }

    private readonly SemaphoreSlim _sem;

    public AiConcurrencyGate(IOptions<AiOptions> options)
    {
        var n = Math.Max(1, options.Value.MaxConcurrent);
        _sem = new SemaphoreSlim(n, n);
    }

    /// <summary>限时排队获取闸位；超时抛 AiBusyException（调用方转 429 SSE error 或 JSON）</summary>
    public async Task<IDisposable> AcquireAsync(TimeSpan timeout, CancellationToken ct)
    {
        if (!await _sem.WaitAsync(timeout, ct)) throw new AiBusyException();
        return new Releaser(this);
    }
}
