namespace HolidayGuideBackend.Entities;

/// <summary>CodeFirst 初始化契约</summary>
public interface IDbInitializer
{
    Task InitAsync();
}
