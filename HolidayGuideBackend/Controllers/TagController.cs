using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace HolidayGuideBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TagController : ControllerBase
{
    private readonly ITagService _service;

    public TagController(ITagService service) => _service = service;

    [HttpGet]
    public async Task<IActionResult> Cloud([FromQuery] int limit = 100)
    {
        var list = await _service.GetTagsAsync(limit);
        return Ok(ApiResult<object>.Ok(list));
    }
}
