namespace HolidayGuideBackend.Entities;

/// <summary>节日/倒计时服务契约</summary>
public interface IHolidayService
{
    Task<List<HolidayCountdownDto>> GetCountdownAsync(int days);
    Task<List<HolidayDto>> GetListAsync();
}

public record HolidayDto(
    int Id, string Name, string Date, string Type, int IsLegal,
    string Description, string CoverImage);
