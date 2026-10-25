using HolidayGuideBackend.Entities;

namespace HolidayGuideBackend.BLL;

/// <summary>
/// 进程级单写者锁 + 当前会话状态。
/// 一次只允许一个更新流程运行；同时负责超时遗留会话清理的协调。
/// </summary>
public class UpdateSessionManager
{
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    /// <summary>当前活跃会话（内存态，进程内唯一）</summary>
    private UpdateSession? _current;
    private readonly object _stateLock = new();

    /// <summary>尝试开启会话。获取不到锁返回 null（Controller 返 409）。</summary>
    public async Task<UpdateSession?> TryBeginAsync(TimeSpan? timeout = null)
    {
        timeout ??= TimeSpan.FromSeconds(30);
        if (!await _writeLock.WaitAsync(timeout.Value))
        {
            return null;
        }
        // 双保险：拿到锁后若内存态仍有会话（理论不该发生），强制释放
        lock (_stateLock)
        {
            if (_current is not null)
            {
                _current = null;
            }
        }
        var session = new UpdateSession(Guid.NewGuid().ToString("N"));
        lock (_stateLock) _current = session;
        return session;
    }

    public UpdateSession? Current
    {
        get { lock (_stateLock) return _current; }
    }

    public void Release(UpdateSession session)
    {
        lock (_stateLock)
        {
            if (_current?.JobId == session.JobId)
            {
                _current = null;
            }
        }
        try { _writeLock.Release(); } catch { /* 已释放则忽略 */ }
    }
}

/// <summary>更新会话句柄</summary>
public record UpdateSession(string JobId);
