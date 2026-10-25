// 生成月度 mock 数据：320 条攻略（跨 3 个批次 150+150+20）+ 10 条节日
// 输出 → HolidayGuideUpdater/data/202608/guides.json
// 字段与后端 GuideItem/HolidayItem 契约对齐（camelCase，绑定侧大小写不敏感）
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESTINATIONS = [
  { name: '北京', region: '北京' },
  { name: '杭州', region: '浙江' },
  { name: '三亚', region: '海南' },
  { name: '成都', region: '四川' },
  { name: '西安', region: '陕西' },
  { name: '广州', region: '广东' },
  { name: '哈尔滨', region: '黑龙江' },
  { name: '青岛', region: '山东' }
]

const SEASONS = ['spring', 'summer', 'autumn', 'winter']

const TAGS = [
  '亲子', '美食', '古镇', '海岛', '滑雪', '温泉', '徒步', '摄影', '博物馆', '夜生活',
  '购物', '赏花', '避暑', '红叶', '露营', '漂流', '古城', '网红打卡', '小众', '自驾', '研学'
]

const CATEGORIES = ['人文', '自然', '美食', '亲子', '休闲', '探险']

// 全部为未来日期，保证倒计时非空（今天是 2026-08-13）
const HOLIDAYS = [
  { name: '七夕', date: '2026-08-19', type: 'traditional', isLegal: 0, description: '中国情人节，浪漫出行' },
  { name: '中秋节', date: '2026-09-25', type: 'traditional', isLegal: 1, description: '赏月吃月饼，阖家团圆' },
  { name: '国庆节', date: '2026-10-01', type: 'legal', isLegal: 1, description: '七天长假，出行高峰，提前规划' },
  { name: '重阳节', date: '2026-10-18', type: 'traditional', isLegal: 0, description: '登高望远，敬老孝亲' },
  { name: '圣诞节', date: '2026-12-25', type: 'custom', isLegal: 0, description: '冬日浪漫氛围' },
  { name: '元旦', date: '2027-01-01', type: 'legal', isLegal: 1, description: '新年第一天，短途出游好时机' },
  { name: '春节', date: '2027-02-06', type: 'traditional', isLegal: 1, description: '回家过年或反向旅行避寒' },
  { name: '清明节', date: '2027-04-05', type: 'traditional', isLegal: 1, description: '踏青扫墓，春游正当时' },
  { name: '劳动节', date: '2027-05-01', type: 'legal', isLegal: 1, description: '五天小长假，中长途旅行' },
  { name: '端午节', date: '2027-06-09', type: 'traditional', isLegal: 1, description: '赛龙舟吃粽子' }
]

const TITLES = ['深度游', '亲子游', '美食之旅', '小众玩法', '三天两晚', '打卡攻略', '摄影机位', 'Citywalk', '避坑指南', '省钱攻略']

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const pickN = (arr, n) => {
  const copy = [...arr]
  const out = []
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0])
  }
  return out
}

const guides = []
for (let i = 0; i < 320; i++) {
  const dest = DESTINATIONS[i % DESTINATIONS.length]
  const season = SEASONS[i % SEASONS.length]
  const holiday = HOLIDAYS[i % HOLIDAYS.length]
  const days = (i % 7) + 1
  const tags = pickN(TAGS, 3)
  const title = `${dest.name}${pick(TITLES)}·第${Math.floor(i / DESTINATIONS.length) + 1}期`
  guides.push({
    externalId: `${dest.name}-${i}`,
    title,
    summary: `${dest.name}旅行精选：${tags.slice(0, 2).join('、')}主题，${days} 天行程不重样`,
    content: `<p>${title}。</p><p>第一天：抵达${dest.name}，入住酒店后漫步市区，感受当地烟火气。</p><p>第二天：打卡核心景点，${tags[0]}主题玩法走起。</p><p>第三天：自由活动，深度体验${tags[1]}文化。</p><p>贴士：${holiday.name}期间出行请提前预订门票与酒店。</p>`,
    coverImage: `https://picsum.photos/seed/hg-${i}/800/500`,
    destination: dest.name,
    region: dest.region,
    season,
    holidayName: holiday.name,
    holidayDate: holiday.date,
    days,
    category: pick(CATEGORIES),
    tags
  })
}

const doc = {
  guides,
  holidays: HOLIDAYS.map(h => ({
    name: h.name,
    date: h.date,
    type: h.type,
    isLegal: h.isLegal,
    description: h.description,
    coverImage: `https://picsum.photos/seed/holiday-${h.name}/800/500`
  }))
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'HolidayGuideUpdater', 'data', '202608', 'guides.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf-8')
console.log(`已生成 ${guides.length} 条攻略 + ${doc.holidays.length} 条节日 → ${outPath}`)
