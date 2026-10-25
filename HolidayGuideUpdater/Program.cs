using HolidayGuideUpdater;
using Microsoft.Extensions.Hosting.WindowsServices;
using Serilog;

var builder = Host.CreateApplicationBuilder(args);

// 服务形态下工作目录是 System32：锚定 exe 目录，保证 appsettings/data/state/logs 落点正确
builder.Configuration.SetBasePath(AppContext.BaseDirectory);
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);
builder.Environment.ContentRootPath = AppContext.BaseDirectory;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console()
    .WriteTo.File(
        Path.Combine(AppContext.BaseDirectory, "logs", "updater-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 14)
    .CreateLogger();
builder.Services.AddSerilog();

// 双形态：dotnet run / 双击 exe = 控制台；sc start = Windows 服务（同一份二进制）
builder.Services.AddWindowsService(o => o.ServiceName = "HolidayGuideUpdater");

var baseUrl = builder.Configuration["Backend:BaseUrl"] ?? "http://127.0.0.1:5099";
if (!baseUrl.EndsWith('/')) baseUrl += "/";
builder.Services.AddHttpClient("backend", c =>
{
    c.BaseAddress = new Uri(baseUrl);
    c.Timeout = TimeSpan.FromSeconds(60); // 150 条含标签插入可能数秒
    c.DefaultRequestHeaders.Add("X-Update-Token", builder.Configuration["Backend:UpdateToken"] ?? "");
});

builder.Services.AddSingleton<StateStore>();
builder.Services.AddSingleton<GuideDataSource>();
builder.Services.AddSingleton<BatchIngestionService>();
builder.Services.AddHostedService<MonthlyScheduler>();

var host = builder.Build();
host.Run();
