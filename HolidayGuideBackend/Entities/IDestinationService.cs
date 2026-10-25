namespace HolidayGuideBackend.Entities;

/// <summary>目的地聚合查询服务契约</summary>
public interface IDestinationService
{
    Task<List<DestinationDto>> GetListAsync(string? region, string? season, int limit);
    /// <summary>首页热门目的地复用（同 GetListAsync 语义的别名）</summary>
    Task<List<DestinationDto>> GetTopAsync(string? region, string? season, int limit);
    Task<DestinationDetailDto?> GetDetailAsync(string name);
}

public record DestinationDetailDto(
    string Name, string Region, int GuideCount,
    List<GuideListItemDto> Guides);
