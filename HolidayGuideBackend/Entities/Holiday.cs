using SqlSugar;

namespace HolidayGuideBackend.Entities;

/// <summary>节日字典表（春节/国庆/中秋等，用于倒计时与专题）</summary>
[SugarTable("Holidays")]
public class Holiday
{
    [SugarColumn(IsPrimaryKey = true, IsIdentity = true)]
    public int Id { get; set; }

    /// <summary>节日名称</summary>
    [SugarColumn(Length = 50)]
    public string Name { get; set; } = string.Empty;

    /// <summary>节日日期（ISO8601，公历）</summary>
    [SugarColumn(Length = 20)]
    public string Date { get; set; } = string.Empty;

    /// <summary>节日类型：traditional/legal/custom</summary>
    [SugarColumn(Length = 20, IsNullable = true)]
    public string Type { get; set; } = string.Empty;

    /// <summary>是否法定节假日（1/0）</summary>
    public int IsLegal { get; set; }

    /// <summary>简介</summary>
    [SugarColumn(Length = 1000, IsNullable = true)]
    public string Description { get; set; } = string.Empty;

    /// <summary>头图 URL</summary>
    [SugarColumn(Length = 500, IsNullable = true)]
    public string CoverImage { get; set; } = string.Empty;

    /// <summary>批次 ID（同样支持原子切换）</summary>
    [SugarColumn(Length = 64)]
    public string BatchId { get; set; } = string.Empty;

    public int Published { get; set; } = 0;
}
