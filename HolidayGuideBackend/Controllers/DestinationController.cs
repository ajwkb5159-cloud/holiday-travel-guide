using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace HolidayGuideBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DestinationController : ControllerBase
{
    private readonly IDestinationService _service;

    public DestinationController(IDestinationService service) => _service = service;

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? region, [FromQuery] string? season, [FromQuery] int limit = 50)
    {
        var list = await _service.GetListAsync(region, season, limit);
        return Ok(ApiResult<object>.Ok(list));
    }

    [HttpGet("{name}")]
    public async Task<IActionResult> Detail(string name)
    {
        var detail = await _service.GetDetailAsync(name);
        if (detail is null) return NotFound(ApiResult<object>.Fail("目的地不存在", 404));
        return Ok(ApiResult<object>.Ok(detail));
    }
}
