namespace HolidayGuideBackend.Infrastructure.Dtos;

/// <summary>批量插入请求（上位机 → 后端）</summary>
public class BatchInsertRequest
{
    public string JobId { get; set; } = string.Empty;
    public string BatchId { get; set; } = string.Empty;
    public List<GuideItem> Guides { get; set; } = new();
    public List<HolidayItem>? Holidays { get; set; }
}

public class GuideItem
{
    public string ExternalId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string CoverImage { get; set; } = string.Empty;
    public string Destination { get; set; } = string.Empty;
    public string Region { get; set; } = string.Empty;
    public string Season { get; set; } = string.Empty;
    public string HolidayName { get; set; } = string.Empty;
    public string HolidayDate { get; set; } = string.Empty;
    public int Days { get; set; }
    public string Category { get; set; } = string.Empty;
    public List<string> Tags { get; set; } = new();
}

public class HolidayItem
{
    public string Name { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public int IsLegal { get; set; }
    public string Description { get; set; } = string.Empty;
    public string CoverImage { get; set; } = string.Empty;
}

/// <summary>更新会话状态 + 上次发布元数据（运维查询 / 前端轮询用）</summary>
public class UpdateStatusDto
{
    /// <summary>idle | Running | Complete ...</summary>
    public string? Status { get; set; }
    public string? JobId { get; set; }
    public string? BatchId { get; set; }
    public string? StartedAt { get; set; }
    public int InsertedCount { get; set; }

    /// <summary>服务模式：normal | updating | maintenance（无已发布数据）</summary>
    public string? Mode { get; set; }
    public bool IsUpdating { get; set; }

    /// <summary>最近一次成功发布的月份 yyyyMM（数据库权威依据）</summary>
    public string? LastMonthKey { get; set; }

    /// <summary>最近一次成功发布时间（yyyy-MM-dd HH:mm:ss）</summary>
    public string? LastPublishTime { get; set; }

    /// <summary>当前已发布攻略数 / 节日数</summary>
    public int GuideCount { get; set; }
    public int HolidayCount { get; set; }

    /// <summary>距上次成功发布的天数（无发布时间时为 null）</summary>
    public int? DataAgeDays { get; set; }

    /// <summary>数据是否陈旧（DataAgeDays &gt; Update:StaleThresholdDays，默认 40 天）；空库不算陈旧</summary>
    public bool IsStale { get; set; }
}

/// <summary>统一 API 响应</summary>
public class ApiResult<T>
{
    public int Code { get; set; } = 0;
    public string Msg { get; set; } = "ok";
    public T? Data { get; set; }

    public static ApiResult<T> Ok(T data) => new() { Data = data };
    public static ApiResult<T> Fail(string msg, int code = -1) => new() { Code = code, Msg = msg };
}
