# 示例数据

`samples/202601/guides.json` 是一份小型演示数据：

- 12 个目的地各 1 篇攻略（北京、杭州、三亚、成都、西安、广州、哈尔滨、青岛、上海、重庆、厦门、桂林）
- 10 个节日
- 封面使用本地 `/images/...` 路径，图片源文件在 `holiday-travel-guide-web/public/images/`
- 示例每城 1 篇，使用 `{slug}-01.jpg`；正式生成时每城 10 篇会分别使用 `-01` 到 `-10` 十个不同景点图

## 加载

```bash
# 从仓库根目录
mkdir -p HolidayGuideUpdater/data/202601
cp samples/202601/guides.json HolidayGuideUpdater/data/202601/guides.json

# 投料到本地后端（需要后端已运行，token 与 appsettings 一致）
dotnet run --project HolidayGuideUpdater -- --run-once --month 202601
```

或者把文件放到部署目录：

```text
<publish-root>/updater/data/202601/guides.json
```

Updater 服务会在 5 分钟内自动发现并原子发布。

## 说明

- `samples/` 不在 Updater 的自动扫描目录内，必须显式复制，避免污染真实月度数据。
- 这是演示数据，不保证内容时效；正式部署请用 `scripts/gen-real.mjs` 生成或接入自己的数据源。
- 图片版权与来源见 [`../holiday-travel-guide-web/public/images/CREDITS.md`](../holiday-travel-guide-web/public/images/CREDITS.md)。
