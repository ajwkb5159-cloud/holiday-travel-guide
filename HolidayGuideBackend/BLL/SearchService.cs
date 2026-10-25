using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using SqlSugar;

namespace HolidayGuideBackend.BLL;

/// <summary>全局搜索服务（FTS5 + bm25 多字段加权；环境不支持 FTS5 时降级 LIKE）</summary>
public class SearchService : ISearchService
{
    private readonly ISqlSugarClient _db;
    private readonly ILogger<SearchService> _logger;
    private int? _ftsAvailable; // null=未探测 0/1

    // bm25 权重（对应 GuidesFts 列顺序：GuideId,Published,Title,Summary,Destination,Tags）
    // UNINDEXED 列权重传 0；Title×3 / Summary×1 / Destination×1.5 / Tags×2。常量无注入风险，直接拼入 SQL
    private const string Bm25Suffix = "bm25(GuidesFts, 0, 0, 3.0, 1.0, 1.5, 2.0)";

    public SearchService(ISqlSugarClient db, ILogger<SearchService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<GuideListItemDto>> SearchAsync(string q, string? type, int limit)
    {
        var rows = await SearchCoreAsync(q, limit);
        return rows.Select(ToListItem).ToList();
    }

    /// <summary>RAG 检索（AI 行程助手专用）：与 SearchAsync 同链路，但返回含正文 Content 的完整实体。
    /// 自然语言长句整句 MATCH/LIKE 往往零命中，故额外做站内词库扩展：
    /// 从问题中抳出已知目的地/分类/标签词，OR 组合二次检索。</summary>
    public async Task<List<Guide>> RetrieveForRagAsync(string q, int limit)
    {
        if (string.IsNullOrWhiteSpace(q)) return [];

        var rows = await SearchCoreAsync(q, limit);
        if (rows.Count > 0) return rows;

        var keywords = await ExtractKnownKeywordsAsync(q);
        if (keywords.Count == 0) return [];

        if (await UseFtsAsync())
        {
            var match = BuildMatch(string.Join(" ", keywords));
            if (match.Length == 0) return [];
            rows = await _db.Ado.SqlQueryAsync<Guide>(
                $$"""
                SELECT g.Id, g.Title, g.Summary, g.Content, g.CoverImage, g.Destination, g.Region,
                       g.Season, g.HolidayName, g.HolidayDate, g.Days, g.Category, g.Tags,
                       g.ViewCount, g.ExternalId, g.Published, g.BatchId, g.CreatedAt
                FROM GuidesFts f JOIN Guides g ON g.Id = f.GuideId
                WHERE GuidesFts MATCH '{{match}}' AND f.Published = 1
                ORDER BY {{Bm25Suffix}}
                LIMIT {{limit}};
                """);
        }
        if (rows.Count == 0)
        {
            // 字典词 LIKE 兼容降级（FTS 不可用或仍无命中）：Expressionable 拼多词 OR
            var exp = SqlSugar.Expressionable.Create<Guide>();
            foreach (var k in keywords)
                exp.Or(g => g.Title.Contains(k) || g.Summary.Contains(k) ||
                            g.Destination.Contains(k) || g.Tags.Contains(k));
            rows = await _db.Queryable<Guide>()
                .Where(g => g.Published == 1)
                .Where(exp.ToExpression())
                .OrderByDescending(g => g.ViewCount)
                .Take(limit)
                .ToListAsync();
        }
        return rows;
    }

    /// <summary>从问题中抳出站内已知词（目的地/分类/标签），长词优先避免子串抢占</summary>
    private async Task<List<string>> ExtractKnownKeywordsAsync(string q)
    {
        var dests = await _db.Queryable<Guide>()
            .Where(g => g.Published == 1).Select(g => g.Destination).Distinct().ToListAsync();
        var cats = await _db.Queryable<Guide>()
            .Where(g => g.Published == 1 && g.Category != "").Select(g => g.Category).Distinct().ToListAsync();
        var tags = await _db.Queryable<GuideTag>()
            .Where(t => t.Published == 1).Select(t => t.Tag).Distinct().ToListAsync();

        return dests.Concat(cats).Concat(tags)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s.Trim())
            .Distinct(StringComparer.Ordinal)
            .OrderByDescending(s => s.Length)
            .Where(q.Contains)
            .Take(8)
            .ToList();
    }

    /// <summary>FTS bm25 优先，无命中降级 LIKE 子串匹配保召回</summary>
    private async Task<List<Guide>> SearchCoreAsync(string q, int limit)
    {
        if (string.IsNullOrWhiteSpace(q)) return [];

        // type 参数当前前端不消费（仅渲染攻略卡片），内部忽略，保留签名不破坏契约
        return await UseFtsAsync()
            ? await SearchByFtsCoreAsync(q, limit)
            : await SearchByLikeCoreAsync(q, limit);
    }

    private async Task<List<Guide>> SearchByFtsCoreAsync(string q, int limit)
    {
        var match = BuildMatch(q);
        if (match.Length == 0) return [];

        // match 经 BuildMatch 严格净化（FTS5 双引号字符串字面量 + 内部引号转义），安全拼接规避 SqlSugar 参数化对 MATCH 语法解析的潜在干扰
        var sql =
            $$"""
            SELECT g.Id, g.Title, g.Summary, g.Content, g.CoverImage, g.Destination, g.Region,
                   g.Season, g.HolidayName, g.HolidayDate, g.Days, g.Category, g.Tags,
                   g.ViewCount, g.ExternalId, g.Published, g.BatchId, g.CreatedAt
            FROM GuidesFts f JOIN Guides g ON g.Id = f.GuideId
            WHERE GuidesFts MATCH '{{match}}' AND f.Published = 1
            ORDER BY {{Bm25Suffix}}
            LIMIT {{limit}};
            """;
        var rows = await _db.Ado.SqlQueryAsync<Guide>(sql);
        // FTS 无命中（如单字/未成词前缀）→ 降级 LIKE 子串匹配保召回，避免「搜北无北京」的反直觉空结果
        if (rows.Count == 0) return await SearchByLikeCoreAsync(q, limit);
        return rows;
    }

    private async Task<List<Guide>> SearchByLikeCoreAsync(string q, int limit)
    {
        var rows = await _db.Queryable<Guide>()
            .Where(g => g.Published == 1)
            .Where(g => g.Title.Contains(q) || g.Summary.Contains(q)
                || g.Destination.Contains(q) || g.Tags.Contains(q))
            .OrderByDescending(g => g.ViewCount)
            .Take(limit)
            .ToListAsync();
        return rows;
    }

    public async Task<List<string>> SuggestAsync(string q, int limit)
    {
        if (string.IsNullOrWhiteSpace(q)) return new List<string>();
        if (!await UseFtsAsync()) return await SuggestByLikeAsync(q, limit);

        var match = BuildMatch(q);
        if (match.Length == 0) return new List<string>();

        var sql =
            $$"""
            SELECT g.Title
            FROM GuidesFts f JOIN Guides g ON g.Id = f.GuideId
            WHERE GuidesFts MATCH '{{match}}' AND f.Published = 1
            ORDER BY {{Bm25Suffix}}
            LIMIT {{limit}};
            """;
        var rows = await _db.Ado.SqlQueryAsync<string>(sql);
        // 同上：FTS 无命中时降级 LIKE 建议（拼音/单字/前缀等未成词场景）
        if (rows.Count == 0) return await SuggestByLikeAsync(q, limit);
        return rows.ToList();
    }

    private async Task<List<string>> SuggestByLikeAsync(string q, int limit)
    {
        var rows = await _db.Queryable<Guide>()
            .Where(g => g.Published == 1 && (g.Title.Contains(q) || g.Tags.Contains(q) || g.Destination.Contains(q)))
            .Take(limit)
            .ToListAsync();
        return rows.Select(g => g.Title).ToList();
    }

    /// <summary>探测 FTS5 是否可用（首次查询时一次性判定，缓存结果）</summary>
    private async Task<bool> UseFtsAsync()
    {
        if (_ftsAvailable.HasValue) return _ftsAvailable.Value == 1;
        try
        {
            var n = (await _db.Ado.SqlQueryAsync<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='GuidesFts';")).FirstOrDefault();
            _ftsAvailable = n > 0 ? 1 : 0;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "FTS5 探测失败，搜索降级 LIKE");
            _ftsAvailable = 0;
        }
        return _ftsAvailable.Value == 1;
    }

    /// <summary>
    /// 把用户输入净化为 FTS5 MATCH 查询串：剥操作符，按空白切词，以 OR 连接（任一命中即可，召回优先）。
    /// 避免用户输入 " * : 等被当 FTS5 语法导致语法错误。
    /// </summary>
    private static string BuildMatch(string q)
    {
        var tokens = q.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(t => t.Trim('"', '*', ':', '(', ')', '^', '\''))
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => '"' + t.Replace("\"", "\"\"") + '"') // 用双引号包裹做短语匹配，转义内部引号
            .ToList();
        return tokens.Count == 0 ? string.Empty : string.Join(" OR ", tokens);
    }

    private static GuideListItemDto ToListItem(Guide g) => new(
        g.Id, g.Title, g.Summary ?? string.Empty, g.CoverImage ?? string.Empty,
        g.Destination, g.Season ?? string.Empty, g.HolidayName ?? string.Empty,
        g.Days, g.Tags ?? string.Empty, g.ViewCount, g.Category ?? string.Empty);
}