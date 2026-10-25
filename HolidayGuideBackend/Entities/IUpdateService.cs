using HolidayGuideBackend.Infrastructure.Dtos;

namespace HolidayGuideBackend.Entities;

/// <summary>上位机写入服务契约（删旧+插新全量替换流程）</summary>
public interface IUpdateService
{
    /// <summary>开启更新会话，获取写锁。返回 null 表示已有会话在跑</summary>
    Task<string?> BeginSessionAsync(string? monthKey = null);

    /// <summary>批量插入（Published=0）。返回 false 表示会话失效</summary>
    Task<bool> InsertBatchAsync(BatchInsertRequest req);

    /// <summary>原子切换：删旧 + 发布新。返回 false 表示会话失效</summary>
    Task<bool> CompleteSessionAsync(string jobId);

    /// <summary>中止会话，释放写锁</summary>
    Task AbortSessionAsync(string jobId);

    /// <summary>查询当前会话状态 + 上次发布元数据（运维/前端轮询用）</summary>
    Task<UpdateStatusDto?> GetStatusAsync();
}
