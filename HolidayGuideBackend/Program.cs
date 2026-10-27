using HolidayGuideBackend.BLL;
using HolidayGuideBackend.Entities;
using HolidayGuideBackend.Infrastructure;
using Microsoft.AspNetCore.ResponseCompression;
using SqlSugar;
using Microsoft.Extensions.Hosting.WindowsServices;

var builder = WebApplication.CreateBuilder(args);

// 服务形态下工作目录是 System32：锚定 exe 目录，保证 appsettings/wwwroot/Data 落点正确
builder.Environment.ContentRootPath = AppContext.BaseDirectory;
builder.Configuration.AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"), optional: true, reloadOnChange: true);
builder.Services.AddWindowsService(o => o.ServiceName = "HolidayGuideBackend");

// SqlSugar + SQLite(WAL)
builder.Services.AddSqlSugar(builder.Configuration);

// L1 内存缓存（只读接口低变更频率，投料 complete 时由 ICacheInvalidator 全失效）
builder.Services.AddMemoryCache(o => o.ExpirationScanFrequency = TimeSpan.FromSeconds(30));
builder.Services.AddSingleton<ICacheInvalidator, CacheInvalidator>();

// 服务运行态（更新窗口/数据就绪标记），供 ServiceGateMiddleware 判定 503
builder.Services.AddSingleton<ServiceStatus>();

// 业务服务注册
builder.Services.AddSingleton<UpdateSessionManager>();
builder.Services.AddScoped<IGuideService, GuideService>();
builder.Services.AddScoped<IDestinationService, DestinationService>();
builder.Services.AddScoped<IHolidayService, HolidayService>();
builder.Services.AddScoped<ITagService, TagService>();
builder.Services.AddScoped<ISearchService, SearchService>();
builder.Services.AddScoped<IUpdateService, UpdateService>();
builder.Services.AddScoped<IFtsSync, FtsSync>();
builder.Services.AddScoped<IDbInitializer, DbInitializer>();

// AI 行程助手：选项绑定 + 上游并发闸/额度计数（单例）+ RAG 流式服务（Scoped，复用 Scoped 搜索服务）
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Ai"));
builder.Services.AddSingleton<AiConcurrencyGate>();
builder.Services.AddSingleton<IAiQuotaService, AiQuotaService>();
builder.Services.AddScoped<IAiChatService, AiChatService>();
builder.Services.AddHttpClient(AiChatService.HttpClientName, c =>
{
    // 流式响应整体读取上限；单次对话由内部 Ai:TimeoutSeconds CTS 控制，这里留 30s 余量
    var aiTimeout = builder.Configuration.GetValue<int?>("Ai:TimeoutSeconds") ?? 120;
    c.Timeout = TimeSpan.FromSeconds(Math.Clamp(aiTimeout, 30, 600) + 30);
});

builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = null; // 保持 PascalCase，前后端一致
    });

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

// OpenAPI 文档（.NET 内置，便于调试）
builder.Services.AddOpenApi();

// 响应压缩：Brotli 优先于 Gzip，覆盖 json/html/js/css/svg
builder.Services.AddResponseCompression(o =>
{
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
    o.MimeTypes = new[] { "application/json", "text/plain", "text/html",
        "application/javascript", "text/javascript", "text/css", "image/svg+xml" };
    o.EnableForHttps = true;
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);

// 健康检查：DB 自定义 Selector 1，无需第三方包
builder.Services.AddHealthChecks()
    .AddCheck<DbHealthCheck>("sqlite", null, new[] { "db" });

var app = builder.Build();

// 启动时初始化数据库
using (var scope = app.Services.CreateScope())
{
    var initializer = scope.ServiceProvider.GetRequiredService<IDbInitializer>();
    await initializer.InitAsync();
    Console.WriteLine("[HolidayGuideBackend] 数据库初始化完成");

    // 初始化服务运行态：库内是否已有已发布数据（空库 → maintenance 模式，读接口 503 直到首次 complete）
    var status = scope.ServiceProvider.GetRequiredService<ServiceStatus>();
    var db = scope.ServiceProvider.GetRequiredService<ISqlSugarClient>();
    var guideCount = await db.Ado.SqlQueryAsync<int>("SELECT COUNT(*) FROM Guides WHERE Published = 1;");
    status.SetHasData(guideCount.FirstOrDefault() > 0);
    Console.WriteLine($"[HolidayGuideBackend] 已发布攻略 {guideCount.FirstOrDefault()} 条");
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// 响应压缩必须注册在静态文件之前：StaticFileMiddleware 命中文件后短路（不调 next），
// 注册在其后的压缩中间件永远收不到静态响应，css/js 将原样下发。
app.UseResponseCompression();
app.UseDefaultFiles();   // "/" → index.html
app.UseStaticFiles();    // wwwroot 静态文件（前端生产构建产物）
app.UseMiddleware<UpdateAuthMiddleware>();
// 读接口服务门（503 繁忙窗口）：放行 /api/update、/api/system、/health
app.UseMiddleware<ServiceGateMiddleware>();
app.UseCors();
app.MapControllers();
app.MapHealthChecks("/health"); // 匿名可达（UpdateAuthMiddleware 只拦 /api/update），便于探活

// SPA fallback：非 /api 未命中路由回 index.html；/api 保持 404 语义；无 wwwroot 时（dev 模式）静默跳过
app.MapFallback(async ctx =>
{
    if (ctx.Request.Path.StartsWithSegments("/api"))
    {
        ctx.Response.StatusCode = StatusCodes.Status404NotFound; // /api 未知路径保持 404 语义
        return;
    }
    var indexPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
    if (File.Exists(indexPath))
    {
        ctx.Response.ContentType = "text/html";
        await ctx.Response.SendFileAsync(indexPath);
    }
});

app.Run();
