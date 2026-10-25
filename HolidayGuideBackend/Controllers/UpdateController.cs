using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace HolidayGuideBackend.Controllers;

/// <summary>上位机数据更新接口（需 X-Update-Token 鉴权）</summary>
[ApiController]
[Route("api/[controller]")]
public class UpdateController : ControllerBase
{
    private readonly IUpdateService _service;
    private readonly ILogger<UpdateController> _logger;

    public UpdateController(IUpdateService service, ILogger<UpdateController> logger)
    {
        _service = service; _logger = logger;
    }

    [HttpPost("begin")]
    public async Task<IActionResult> Begin([FromBody] BeginRequest? req = null)
    {
        // monthKey 可选：Updater 携带数据月份，用于落库发布元数据；旧调用方（无 body）兼容
        var jobId = await _service.BeginSessionAsync(req?.MonthKey);
        if (jobId is null)
        {
            return Conflict(ApiResult<object>.Fail("已有更新流程正在运行", 409));
        }
        return Ok(ApiResult<object>.Ok(new { jobId, batchId = jobId }));
    }

    [HttpPost("batch")]
    public async Task<IActionResult> Batch([FromBody] BatchInsertRequest req)
    {
        if (string.IsNullOrEmpty(req.JobId) || req.Guides.Count == 0)
        {
            return BadRequest(ApiResult<object>.Fail("请求参数缺失", 400));
        }
        var ok = await _service.InsertBatchAsync(req);
        if (!ok)
        {
            return Conflict(ApiResult<object>.Fail("会话不存在或已失效，请重新 begin", 409));
        }
        return Ok(ApiResult<object>.Ok(new { received = req.Guides.Count }));
    }

    [HttpPost("complete")]
    public async Task<IActionResult> Complete([FromBody] CompleteRequest req)
    {
        var ok = await _service.CompleteSessionAsync(req.JobId);
        if (!ok)
        {
            return Conflict(ApiResult<object>.Fail("会话不存在或已失效", 409));
        }
        return Ok(ApiResult<object>.Ok(new { done = true }));
    }

    [HttpPost("abort")]
    public async Task<IActionResult> Abort([FromBody] CompleteRequest req)
    {
        await _service.AbortSessionAsync(req.JobId);
        return Ok(ApiResult<object>.Ok(new { aborted = true }));
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var status = await _service.GetStatusAsync() ?? new UpdateStatusDto();
        return Ok(ApiResult<object>.Ok(status));
    }
}

public class CompleteRequest
{
    public string JobId { get; set; } = string.Empty;
}

public class BeginRequest
{
    public string? MonthKey { get; set; }
}
