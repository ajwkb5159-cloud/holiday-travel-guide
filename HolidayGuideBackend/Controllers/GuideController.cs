using HolidayGuideBackend.BLL;
using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace HolidayGuideBackend.Controllers;

/// <summary>前端只读攻略查询接口（无鉴权）</summary>
[ApiController]
[Route("api/[controller]")]
public class GuideController : ControllerBase
{
    private readonly IGuideService _guideService;
    private readonly ILogger<GuideController> _logger;

    public GuideController(IGuideService guideService, ILogger<GuideController> logger)
    {
        _guideService = guideService; _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] GuideQueryDto query)
    {
        var result = await _guideService.GetListAsync(query);
        return Ok(ApiResult<object>.Ok(new { result.Items, result.Total, result.Page, result.Size }));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Detail(int id)
    {
        var detail = await _guideService.GetDetailAsync(id);
        if (detail is null) return NotFound(ApiResult<object>.Fail("攻略不存在", 404));
        return Ok(ApiResult<object>.Ok(detail));
    }

    [HttpGet("ranking")]
    public async Task<IActionResult> Ranking([FromQuery] string type = "hot", [FromQuery] int limit = 20)
    {
        var list = await _guideService.GetRankingAsync(type, limit);
        return Ok(ApiResult<object>.Ok(list));
    }

    [HttpGet("seasonal")]
    public async Task<IActionResult> Seasonal([FromQuery] string? season, [FromQuery] int limit = 6)
    {
        season ??= GuideService.CurrentSeason();
        var list = await _guideService.GetSeasonalAsync(season, limit);
        return Ok(ApiResult<object>.Ok(list));
    }

    [HttpGet("home")]
    public async Task<IActionResult> Home()
    {
        var agg = await _guideService.GetHomeAggregateAsync();
        return Ok(ApiResult<object>.Ok(agg));
    }

    /// <summary>个性化推荐「猜你喜欢」：参数为逗号分隔列表（前端 localStorage 行为信号）</summary>
    [HttpGet("recommend")]
    public async Task<IActionResult> Recommend(
        [FromQuery] string? destinations, [FromQuery] string? categories,
        [FromQuery] string? tags, [FromQuery] string? excludeIds,
        [FromQuery] int limit = 8)
    {
        var query = new RecommendQuery(
            SplitList(destinations), SplitList(categories), SplitList(tags),
            (excludeIds ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => int.TryParse(s, out var n) ? n : -1)
                .Where(n => n > 0)
                .ToList(),
            limit);
        var list = await _guideService.GetRecommendAsync(query);
        return Ok(ApiResult<object>.Ok(list));
    }

    private static List<string> SplitList(string? csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? []
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}
