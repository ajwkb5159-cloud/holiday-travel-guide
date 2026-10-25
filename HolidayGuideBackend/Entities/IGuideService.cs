namespace HolidayGuideBackend.Entities;

/// <summary>前端只读查询服务契约（攻略侧）</summary>
public interface IGuideService
{
    /// <summary>攻略列表（分页+筛选）</summary>
    Task<PagedResult<GuideListItemDto>> GetListAsync(GuideQueryDto query);

    /// <summary>攻略详情</summary>
    Task<GuideDetailDto?> GetDetailAsync(int id);

    /// <summary>排行榜</summary>
    Task<List<GuideListItemDto>> GetRankingAsync(string type, int limit);

    /// <summary>季节推荐</summary>
    Task<List<GuideListItemDto>> GetSeasonalAsync(string season, int limit);

    /// <summary>首页聚合（倒计时+当季+热门）</summary>
    Task<HomeAggregateDto> GetHomeAggregateAsync();

    /// <summary>个性化推荐「猜你喜欢」：基于前端行为信号（目的地/分类/标签亲和度）+ 热门度 + 当季加权打分</summary>
    Task<List<GuideListItemDto>> GetRecommendAsync(RecommendQuery query);
}

public record PagedResult<T>(List<T> Items, int Total, int Page, int Size);

public record GuideListItemDto(
    int Id, string Title, string Summary, string CoverImage,
    string Destination, string Season, string HolidayName,
    int Days, string Tags, int ViewCount, string Category);

public record GuideDetailDto(
    int Id, string Title, string Summary, string Content, string CoverImage,
    string Destination, string Region, string Season, string HolidayName,
    string HolidayDate, int Days, string Category, string Tags, int ViewCount,
    string CreatedAt, List<string> TagList, List<GuideListItemDto> Related);

public record GuideQueryDto(
    string? Category, string? Keyword, string? Destination,
    string? Season, string? HolidayName, string? Sort, int Page = 1, int Size = 10);

/// <summary>个性化推荐入参（来自前端 localStorage 行为信号；全空时退化为热门榜语义）</summary>
public record RecommendQuery(
    List<string> Destinations,
    List<string> Categories,
    List<string> Tags,
    List<int> ExcludeIds,
    int Limit = 8);

public record HomeAggregateDto(
    List<HolidayCountdownDto> Countdowns,
    List<GuideListItemDto> Seasonal,
    List<GuideListItemDto> Hot,
    List<DestinationDto> HotDestinations,
    List<GuideListItemDto> NearestGuides);

public record HolidayCountdownDto(string Name, string Date, int DaysLeft, string Type, string CoverImage);

public record DestinationDto(string Name, string Region, int GuideCount, string CoverImage);
