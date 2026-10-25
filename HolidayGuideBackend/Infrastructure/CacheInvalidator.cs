using System.Collections.Concurrent;
using Microsoft.Extensions.Caching.Memory;

namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// 基于 IMemoryCache 的统一缓存包装 + 主动失效编排。
/// .NET IMemoryCache 无原生键枚举，维护 ConcurrentDictionary 登记 key 供全失效使用。
/// 设计取舍：投料是日级低频操作，complete 后「全失效」比逐项失效简单且不会漏，避免缓存与 Published 切换出现脏窗口。
/// </summary>
public interface ICacheInvalidator
{
    /// <summary>投料 complete 成功后调用：清空所有已登记的 L1 缓存</summary>
    Task InvalidateAllAsync();

    /// <summary>登记一个缓存 key（写缓存时调用），便于后续全失效遍历</summary>
    void Register(string key);

    /// <summary>读取或写入缓存，自动登记 key</summary>
    Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> factory, TimeSpan ttl);
}

public class CacheInvalidator : ICacheInvalidator
{
    private readonly IMemoryCache _cache;
    private readonly ConcurrentDictionary<string, byte> _keys = new();
    private readonly ILogger<CacheInvalidator> _logger;

    public CacheInvalidator(IMemoryCache cache, ILogger<CacheInvalidator> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    /// <summary>登记一个缓存 key（写缓存时调用），便于后续全失效遍历</summary>
    public void Register(string key) => _keys.TryAdd(key, 0);

    /// <summary>读取或写入缓存，自动登记 key</summary>
    public async Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> factory, TimeSpan ttl)
    {
        Register(key);
        var value = await _cache.GetOrCreateAsync(key, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = ttl;
            return await factory();
        });
        return value ?? await factory(); // 极端情况 GetOrCreateAsync 返回 null（不应发生），回退直接取值
    }

    public Task InvalidateAllAsync()
    {
        var n = _keys.Count;
        foreach (var key in _keys.Keys)
        {
            _cache.Remove(key);
            _keys.TryRemove(key, out _);
        }
        _logger.LogInformation("缓存全失效，已清除 {Count} 个 key", n);
        return Task.CompletedTask;
    }
}