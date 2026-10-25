namespace HolidayGuideBackend.Entities;

/// <summary>标签云服务契约</summary>
public interface ITagService
{
    Task<List<TagCountDto>> GetTagsAsync(int limit);
}

public record TagCountDto(string Tag, int Count);
