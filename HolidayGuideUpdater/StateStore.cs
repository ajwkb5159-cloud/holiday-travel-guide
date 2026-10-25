using System.Text.Json;

namespace HolidayGuideUpdater;

/// <summary>更新状态（断点续传落盘）</summary>
public class UpdaterState
{
    public string MonthKey { get; set; } = "";
    /// <summary>idle | uploading | completed | failed</summary>
    public string Status { get; set; } = "idle";
    public string JobId { get; set; } = "";
    public int LastBatchIndex { get; set; } = -1;
    public int TotalBatches { get; set; }
    public string StartedAt { get; set; } = "";
    public string UpdatedAt { get; set; } = "";
    public string LastError { get; set; } = "";
}

/// <summary>状态文件持久化（原子写：.tmp + Move overwrite，防断电损坏）</summary>
public class StateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private readonly string _path = Path.Combine(AppContext.BaseDirectory, "state.json");

    public UpdaterState Load()
    {
        if (!File.Exists(_path)) return new UpdaterState();
        try
        {
            return JsonSerializer.Deserialize<UpdaterState>(File.ReadAllText(_path), JsonOptions)
                   ?? new UpdaterState();
        }
        catch (JsonException)
        {
            return new UpdaterState();
        }
    }

    public void Save(UpdaterState state)
    {
        state.UpdatedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(state, JsonOptions));
        File.Move(tmp, _path, overwrite: true);
    }
}
