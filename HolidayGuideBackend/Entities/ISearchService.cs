namespace HolidayGuideBackend.Entities;

/// <summary>全局搜索服务契约</summary>
public interface ISearchService
{
    Task<List<GuideListItemDto>> SearchAsync(string q, string? type, int limit);
    Task<List<string>> SuggestAsync(string q, int limit);

    /// <summary>RAG 检索（AI 行程助手）：同搜索链路，返回含正文的完整实体供 prompt 注入</summary>
    Task<List<Guide>> RetrieveForRagAsync(string q, int limit);
}
