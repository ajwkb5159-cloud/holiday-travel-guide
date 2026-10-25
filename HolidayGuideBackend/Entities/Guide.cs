using SqlSugar;

namespace HolidayGuideBackend.Entities;

/// <summary>
/// 旅游攻略主表实体
/// </summary>
[SugarTable("Guides")]
public class Guide
{
    [SugarColumn(IsPrimaryKey = true, IsIdentity = true)]
    public int Id { get; set; }

    /// <summary>外部业务 ID（来自上位机数据源，断点续传去重用）</summary>
    [SugarColumn(Length = 64)]
    public string ExternalId { get; set; } = string.Empty;

    /// <summary>攻略标题</summary>
    [SugarColumn(Length = 200)]
    public string Title { get; set; } = string.Empty;

    /// <summary>摘要</summary>
    [SugarColumn(Length = 500, IsNullable = true)]
    public string Summary { get; set; } = string.Empty;

    /// <summary>正文（图文 HTML / Markdown 文本）</summary>
    [SugarColumn(ColumnDataType = "TEXT", IsNullable = true)]
    public string Content { get; set; } = string.Empty;

    /// <summary>封面图 URL</summary>
    [SugarColumn(Length = 500, IsNullable = true)]
    public string CoverImage { get; set; } = string.Empty;

    /// <summary>目的地/城市</summary>
    [SugarColumn(Length = 100)]
    public string Destination { get; set; } = string.Empty;

    /// <summary>所属地区（省/直辖市）</summary>
    [SugarColumn(Length = 100, IsNullable = true)]
    public string Region { get; set; } = string.Empty;

    /// <summary>应季：spring/summer/autumn/winter</summary>
    [SugarColumn(Length = 20, IsNullable = true)]
    public string Season { get; set; } = string.Empty;

    /// <summary>关联节日名称（可空，非节日专题则为空）</summary>
    [SugarColumn(Length = 50, IsNullable = true)]
    public string HolidayName { get; set; } = string.Empty;

    /// <summary>关联节日日期（ISO8601 字符串，可空）</summary>
    [SugarColumn(Length = 20, IsNullable = true)]
    public string HolidayDate { get; set; } = string.Empty;

    /// <summary>推荐行程天数</summary>
    public int Days { get; set; }

    /// <summary>分类：与 Destination 维度并行的业务分类</summary>
    [SugarColumn(Length = 50, IsNullable = true)]
    public string Category { get; set; } = string.Empty;

    /// <summary>标签（逗号分隔，冗余便于检索；明细见 GuideTag 表）</summary>
    [SugarColumn(Length = 500, IsNullable = true)]
    public string Tags { get; set; } = string.Empty;

    /// <summary>浏览量</summary>
    public int ViewCount { get; set; }

    /// <summary>★ 是否已发布（0=待发布/新批次,1=已发布对游客可见）。读一致性核心字段</summary>
    public int Published { get; set; } = 0;

    /// <summary>★ 批次 ID（GUID，原子切换用）</summary>
    [SugarColumn(Length = 64)]
    public string BatchId { get; set; } = string.Empty;

    /// <summary>插入时间</summary>
    [SugarColumn(Length = 32)]
    public string CreatedAt { get; set; } = string.Empty;
}
