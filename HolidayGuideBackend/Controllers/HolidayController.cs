using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace HolidayGuideBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HolidayController : ControllerBase
{
    private readonly IHolidayService _service;

    public HolidayController(IHolidayService service) => _service = service;

    [HttpGet("countdown")]
    public async Task<IActionResult> Countdown([FromQuery] int days = 60)
    {
        var list = await _service.GetCountdownAsync(days);
        return Ok(ApiResult<object>.Ok(list));
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var list = await _service.GetListAsync();
        return Ok(ApiResult<object>.Ok(list));
    }
}
