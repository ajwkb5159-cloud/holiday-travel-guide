using System.Security.Cryptography;
using System.Text;

namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// 客户端 IP 提取：Kestrel 仅绑定 127.0.0.1，公网流量全部经 cpolar 隧道进入，
/// RemoteIpAddress 恒为回环地址 —— 必须解析 X-Forwarded-For 首段才是真实客户端 IP。
/// 回环绑定下 XFF 无法被外部绕过（直连端口仅限本机）；XFF 头本身可伪造轮换，
/// 故 AI 限额在 IP 维度之外另设全局日上限兜底（见 AiOptions.GlobalDailyCap）。
/// </summary>
public static class ClientIpResolver
{
    public static string Resolve(HttpContext ctx)
    {
        var xff = ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(xff))
        {
            var first = xff.Split(',')[0].Trim();
            // 形如 "1.2.3.4:56789" 的带端口写法剥掉端口（IPv6 带端口必含方括号，先去括号）
            if (first.StartsWith('[') && first.IndexOf(']') is > 0 and var close)
                first = first.Substring(1, close - 1);
            else
            {
                var colon = first.LastIndexOf(':');
                if (colon > 0 && first.Count(c => c == ':') == 1) first = first[..colon];
            }
            if (first.Length > 0) return Normalize(first);
        }
        return Normalize(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown");
    }

    /// <summary>IPv6 回环等价成 IPv4 写法，避免同一客户端因表示法不同被算两个 IP</summary>
    private static string Normalize(string ip)
    {
        if (ip is "::1" or "[::1]") return "127.0.0.1";
        return ip.Length > 64 ? ip[..64] : ip; // 兜底截断，Scope 列防异常超长输入
    }

    /// <summary>按日盐值打散用的稳定哈希（推荐排序同日同序、跨日变化）</summary>
    public static int StableHash(string s, string salt)
    {
        var bytes = Encoding.UTF8.GetBytes(s + "|" + salt);
        var h = MD5.HashData(bytes);
        return BitConverter.ToInt32(h, 0);
    }
}
