using SqlSugar;

namespace HolidayGuideBackend.Entities;

/// <summary>更新任务记录（断点续传、超时清理、运维审计、发布时间元数据用）</summary>
[SugarTable("UpdateJobs")]
public class UpdateJob
{
    [SugarColumn(IsPrimaryKey = true, Length = 64)]
    public string JobId { get; set; } = string.Empty;

    /// <summary>状态：Begin / Running / Complete / Abort / Abandoned</summary>
    [SugarColumn(Length = 20)]
    public string Status { get; set; } = string.Empty;

    /// <summary>本批次 BatchId（与新插入数据的 BatchId 一致）</summary>
    [SugarColumn(Length = 64)]
    public string BatchId { get; set; } = string.Empty;

    /// <summary>数据所属月份 yyyyMM（begin 时由上位机/Updater 携带，null 兼容旧调用方）</summary>
    [SugarColumn(Length = 8, IsNullable = true)]
    public string? MonthKey { get; set; }

    [SugarColumn(Length = 32)]
    public string StartedAt { get; set; } = string.Empty;

    [SugarColumn(Length = 32, IsNullable = true)]
    public string FinishedAt { get; set; } = string.Empty;

    /// <summary>已插入条数</summary>
    public int InsertedCount { get; set; }

    /// <summary>批次总数</summary>
    public int BatchCount { get; set; }

    /// <summary>发布时已发布攻略总数（complete 时统计，运维审计 + 数据新鲜度展示）</summary>
    [SugarColumn(IsNullable = true)]
    public int? GuideCount { get; set; }

    /// <summary>发布时已发布节日总数</summary>
    [SugarColumn(IsNullable = true)]
    public int? HolidayCount { get; set; }
}
