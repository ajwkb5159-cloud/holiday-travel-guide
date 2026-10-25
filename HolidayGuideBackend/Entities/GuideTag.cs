using SqlSugar;

namespace HolidayGuideBackend.Entities;

/// <summary>攻略标签（多对一，每条标签一行，便于标签云聚合）</summary>
[SugarTable("GuideTags")]
public class GuideTag
{
    [SugarColumn(IsPrimaryKey = true, IsIdentity = true)]
    public int Id { get; set; }

    [SugarColumn(Length = 50)]
    public string Tag { get; set; } = string.Empty;

    public int GuideId { get; set; }

    /// <summary>同 Guide.BatchId，切换时一并删除旧批次</summary>
    [SugarColumn(Length = 64)]
    public string BatchId { get; set; } = string.Empty;

    /// <summary>同 Guide.Published</summary>
    public int Published { get; set; } = 0;
}
