namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// AI 行程助手配置（appsettings.json "Ai" 节）。
/// Key 解析优先级：ApiKey → ApiKeyFile → OPENCODE_API_KEY_FILE / OPENCODE_GO_API_KEY / OPENCODE_API_KEY。
/// 生产用绝对路径 ApiKeyFile（SYSTEM 服务的 ~ 指向 systemprofile，不能依赖用户目录）。
/// </summary>
public class AiOptions
{
    /// <summary>总开关：false 时 /api/ai/chat 返回 501，前端隐藏悬浮球入口</summary>
    public bool Enabled { get; set; } = false;

    /// <summary>OpenAI 兼容 chat/completions 完整端点（代码不会自动追加 /v1 或 /chat/completions）</summary>
    public string BaseURL { get; set; } = "https://opencode.ai/zen/go/v1/chat/completions";

    /// <summary>API Key（留空则按 ApiKeyFile/环境变量顺序解析）</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>API Key 文件绝对路径（生产推荐；SYSTEM 下不要用 ~）</summary>
    public string ApiKeyFile { get; set; } = string.Empty;

    /// <summary>模型名</summary>
    public string Model { get; set; } = "deepseek-v4.1-flash";

    /// <summary>单次回答最大 token；推理模型会先消耗 reasoning token，留足余量</summary>
    public int MaxTokens { get; set; } = 3000;

    /// <summary>采样温度</summary>
    public double Temperature { get; set; } = 0.7;

    /// <summary>上游流式响应超时（秒）</summary>
    public int TimeoutSeconds { get; set; } = 120;

    /// <summary>是否把 assistant 历史的 reasoning_content 回传给上游（DeepSeek 系模型可能需要）</summary>
    public bool SendReasoningContent { get; set; } = false;

    /// <summary>OpenCode Go 的稳定会话 ID（留空则按客户端 IP 哈希生成）</summary>
    public string SessionId { get; set; } = string.Empty;

    /// <summary>可选：合并进请求体的 JSON（provider 特有参数，如 {"thinking":{"type":"disabled"}}）</summary>
    public string ExtraBodyJson { get; set; } = string.Empty;

    /// <summary>是否启用每日额度限制；false = 不限次数（默认，纯对话窗口）</summary>
    public bool QuotaEnabled { get; set; } = false;

    /// <summary>多轮历史最多保留条数（1M 上下文场景可放宽）</summary>
    public int HistoryMaxTurns { get; set; } = 500;

    /// <summary>多轮历史总字符预算（默认 150 万中文字符，约 1M tokens）</summary>
    public int HistoryMaxChars { get; set; } = 1_500_000;

    /// <summary>单条历史消息最大字符数</summary>
    public int HistoryPerMessageChars { get; set; } = 50_000;

    /// <summary>每 IP 每日问答次数（仅在 QuotaEnabled=true 时生效）</summary>
    public int DailyIpQuota { get; set; } = 10;

    /// <summary>全站每日总上限（仅在 QuotaEnabled=true 时生效）</summary>
    public int GlobalDailyCap { get; set; } = 500;

    /// <summary>RAG 检索条数（注入 prompt 的站内攻略篇数）</summary>
    public int RetrieveTopK { get; set; } = 6;

    /// <summary>上游 LLM 并发闸（SQLite 单机 + 低配服务器，控制同时出站的 LLM 请求数省性能）</summary>
    public int MaxConcurrent { get; set; } = 3;
}
