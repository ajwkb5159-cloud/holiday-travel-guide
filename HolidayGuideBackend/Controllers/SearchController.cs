using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace HolidayGuideBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SearchController : ControllerBase
{
    private readonly ISearchService _service;

    public SearchController(ISearchService service) => _service = service;

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string q, [FromQuery] string? type, [FromQuery] int limit = 20)
    {
        var list = await _service.SearchAsync(q, type, limit);
        return Ok(ApiResult<object>.Ok(list));
    }

    [HttpGet("suggest")]
    public async Task<IActionResult> Suggest([FromQuery] string q, [FromQuery] int limit = 10)
    {
        var list = await _service.SuggestAsync(q, limit);
        return Ok(ApiResult<object>.Ok(list));
    }
}
