namespace HolidayGuideBackend.Infrastructure;

/// <summary>
/// 服务运行态（进程内单例）：更新会话是否活跃、数据是否就绪。
/// 供 ServiceGateMiddleware 决定是否对读接口返回 503「服务器繁忙」。
/// 内存态随进程生命周期：服务重启后由 Program 启动初始化与 complete 流程刷新。
/// </summary>
public class ServiceStatus
{
    private int _updating;
    private int _hasData = 1; // 默认有数据；启动初始化按实际 published 计数刷新

    public bool IsUpdating => Volatile.Read(ref _updating) == 1;
    public bool HasData => Volatile.Read(ref _hasData) == 1;

    public void SetUpdating(bool value) => Volatile.Write(ref _updating, value ? 1 : 0);
    public void SetHasData(bool value) => Volatile.Write(ref _hasData, value ? 1 : 0);
}
