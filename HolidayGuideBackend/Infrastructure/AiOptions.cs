namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// AI 行程助手配置（appsettings.json "Ai" 节）。
/// ApiKey 解析优先级：配置显式值 → 环境变量 DASHSCOPE_API_KEY → 用户目录 ~/.dashscope.key（开发便利，与 gen-real.mjs 同链路）。
/// 生产建议服务级环境变量注入，避免 key 落盘到发布目录。
/// </summary>
public class AiOptions
{
    /// <summary>总开关：false 时 /api/ai/chat 返回 501，前端隐藏悬浮球入口</summary>
    public bool Enabled { get; set; } = false;

    /// <summary>OpenAI 兼容 chat/completions 端点（DashScope compatible-mode，可换 glm/deepseek）</summary>
    public string BaseURL { get; set; } = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

    /// <summary>API Key（留空则按环境变量/密钥文件顺序解析）</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>模型名</summary>
    public string Model { get; set; } = "qwen-flash";

    /// <summary>每 IP 每日免费问答次数</summary>
    public int DailyIpQuota { get; set; } = 10;

    /// <summary>全站每日总上限（防 XFF 伪造轮换 IP 刷量的兜底闸）</summary>
    public int GlobalDailyCap { get; set; } = 500;

    /// <summary>RAG 检索条数（注入 prompt 的站内攻略篇数）</summary>
    public int RetrieveTopK { get; set; } = 6;

    /// <summary>上游 LLM 并发闸（SQLite 单机 + 低配服务器，控制同时出站的 LLM 请求数省性能）</summary>
    public int MaxConcurrent { get; set; } = 3;
}
