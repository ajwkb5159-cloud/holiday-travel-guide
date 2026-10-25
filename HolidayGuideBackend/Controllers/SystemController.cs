using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace HolidayGuideBackend.Controllers;

/// <summary>
/// 系统公开状态接口（无鉴权）：前端轮询「服务器繁忙」遮罩与数据新鲜度展示用。
/// 注意：ServiceGateMiddleware 放行 /api/system/*，该接口在更新窗口内仍可访问。
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class SystemController : ControllerBase
{
    private readonly IUpdateService _service;

    public SystemController(IUpdateService service)
    {
        _service = service;
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var status = await _service.GetStatusAsync() ?? new UpdateStatusDto();
        return Ok(ApiResult<object>.Ok(status));
    }
}
