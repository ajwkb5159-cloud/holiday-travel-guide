// 动态节日窗口：给定目标月份，算出 10 个节日在下一次 12 个月窗口内的真实公历日期。
//
// 设计要点：
// - 窗口起点 = 目标月往前 3 个月的 1 号，长度 12 个月。
//   该规则对 202610 精确复现历史上硬编码的 10 个日期，跨年自动滚动。
// - 农历节日用 lunar-javascript 按日枚举匹配，闰月不参与（getMonth() 为负数）。
// - 清明按节气匹配，不按固定 4 月 5 日。
// - 枚举用 Solar.next(1)，不经过 JS Date，避免时区/夏令时把日期挪一天。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Solar } = require('lunar-javascript')

/** 节日定义顺序即封面索引顺序（{slug}-01..10.jpg），不要随意调整。 */
export const HOLIDAY_DEFS = [
  { slug: 'qixi', name: '七夕', type: 'traditional', isLegal: 0, season: 'summer', days: 3, description: '中国情人节，浪漫出行', rule: { kind: 'lunar', month: 7, day: 7 } },
  { slug: 'zhongqiu', name: '中秋节', type: 'traditional', isLegal: 1, season: 'autumn', days: 3, description: '赏月吃月饼，阖家团圆', rule: { kind: 'lunar', month: 8, day: 15 } },
  { slug: 'guoqing', name: '国庆节', type: 'legal', isLegal: 1, season: 'autumn', days: 5, description: '七天长假，出行高峰，提前规划', rule: { kind: 'fixed', month: 10, day: 1 } },
  { slug: 'chongyang', name: '重阳节', type: 'traditional', isLegal: 0, season: 'autumn', days: 3, description: '登高望远，敬老孝亲', rule: { kind: 'lunar', month: 9, day: 9 } },
  { slug: 'shengdan', name: '圣诞节', type: 'custom', isLegal: 0, season: 'winter', days: 3, description: '冬日浪漫氛围', rule: { kind: 'fixed', month: 12, day: 25 } },
  { slug: 'yuandan', name: '元旦', type: 'legal', isLegal: 1, season: 'winter', days: 3, description: '新年第一天，短途出游好时机', rule: { kind: 'fixed', month: 1, day: 1 } },
  { slug: 'chunjie', name: '春节', type: 'traditional', isLegal: 1, season: 'winter', days: 5, description: '回家过年或反向旅行避寒', rule: { kind: 'lunar', month: 1, day: 1 } },
  { slug: 'qingming', name: '清明节', type: 'traditional', isLegal: 1, season: 'spring', days: 3, description: '踏青扫墓，春游正当时', rule: { kind: 'jieqi', name: '清明' } },
  { slug: 'laodong', name: '劳动节', type: 'legal', isLegal: 1, season: 'spring', days: 5, description: '五天小长假，中长途旅行', rule: { kind: 'fixed', month: 5, day: 1 } },
  { slug: 'duanwu', name: '端午节', type: 'traditional', isLegal: 1, season: 'summer', days: 4, description: '赛龙舟吃粽子', rule: { kind: 'lunar', month: 5, day: 5 } }
]

export const HOLIDAY_SLUG_BY_NAME = new Map(HOLIDAY_DEFS.map(h => [h.name, h.slug]))
export const HOLIDAY_INDEX_BY_SLUG = new Map(HOLIDAY_DEFS.map((h, i) => [h.slug, i]))

function parseMonthKey(monthKey) {
  const text = String(monthKey || '')
  if (!/^\d{6}$/.test(text)) throw new Error(`月份格式应为 yyyyMM，收到: ${monthKey}`)
  const year = Number(text.slice(0, 4))
  const month = Number(text.slice(4, 6))
  if (month < 1 || month > 12) throw new Error(`月份非法: ${monthKey}`)
  return { year, month }
}

function shiftMonth(year, month, delta) {
  const zero = year * 12 + (month - 1) + delta
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 }
}

function pad2(n) { return String(n).padStart(2, '0') }

function matchesRule(solar, rule) {
  const lunar = solar.getLunar()
  if (rule.kind === 'fixed') {
    return solar.getMonth() === rule.month && solar.getDay() === rule.day
  }
  if (rule.kind === 'jieqi') {
    return lunar.getJieQi() === rule.name
  }
  // 闰月 getMonth() 为负数，农历节日只在正常月份匹配
  return lunar.getMonth() === rule.month && lunar.getDay() === rule.day
}

/**
 * 计算目标月份对应的 10 个节日。
 * @param {string} monthKey yyyyMM
 * @param {{legalSpans?: Record<string, {days?:number,isLegal?:number}>}} [opts]
 *   legalSpans 可按 slug 覆盖法定天数/是否法定（来自官方节假日安排）。
 */
export function buildHolidayWindow(monthKey, opts = {}) {
  const { year, month } = parseMonthKey(monthKey)
  const start = shiftMonth(year, month, -3)
  const startMonthKey = `${start.year}-${pad2(start.month)}-01`

  let cursor = Solar.fromYmd(start.year, start.month, 1)
  const found = new Map()

  // 366 天足够覆盖任何 12 个月窗口（含闰年）
  for (let i = 0; i < 366 && found.size < HOLIDAY_DEFS.length; i++) {
    for (const def of HOLIDAY_DEFS) {
      if (found.has(def.slug)) continue
      if (matchesRule(cursor, def.rule)) {
        found.set(def.slug, cursor.toYmd())
      }
    }
    cursor = cursor.next(1)
  }

  const missing = HOLIDAY_DEFS.filter(d => !found.has(d.slug)).map(d => d.slug)
  if (missing.length) throw new Error(`节日窗口计算失败，缺少: ${missing.join(', ')}`)

  return HOLIDAY_DEFS.map(def => {
    const override = opts.legalSpans?.[def.slug] || opts.legalSpans?.[def.name] || {}
    return {
      slug: def.slug,
      name: def.name,
      date: found.get(def.slug),
      type: def.type,
      isLegal: Number.isFinite(override.isLegal) ? override.isLegal : def.isLegal,
      description: def.description,
      season: def.season,
      days: Number.isFinite(override.days) ? override.days : def.days
    }
  })
}

/** 只校验日期与顺序；供测试/生成器复用。 */
export function assertHolidayWindow(holidays, expectedDates = null) {
  const errors = []
  if (!Array.isArray(holidays) || holidays.length !== HOLIDAY_DEFS.length) {
    errors.push(`节日数量应为 ${HOLIDAY_DEFS.length}，实际 ${holidays?.length ?? 0}`)
  }
  const slugs = new Set()
  for (let i = 0; i < (holidays?.length ?? 0); i++) {
    const h = holidays[i]
    if (h.slug !== HOLIDAY_DEFS[i].slug) errors.push(`第 ${i + 1} 个节日应为 ${HOLIDAY_DEFS[i].slug}，实际 ${h.slug}`)
    if (slugs.has(h.slug)) errors.push(`节日 slug 重复: ${h.slug}`)
    slugs.add(h.slug)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) errors.push(`${h.slug} 日期格式非法: ${h.date}`)
  }
  if (expectedDates) {
    for (const [slug, date] of Object.entries(expectedDates)) {
      const h = holidays.find(x => x.slug === slug)
      if (!h) errors.push(`缺少节日: ${slug}`)
      else if (h.date !== date) errors.push(`${slug} 日期应为 ${date}，实际 ${h.date}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** 给 prompt 用的事实块（不依赖网络）。 */
export function holidaysPromptBlock(holidays) {
  return holidays.map(h => `- ${h.name}：${h.date}（${h.isLegal ? '法定假日' : '非放假日'}，建议 ${h.days} 天行程）`).join('\n')
}

export { parseMonthKey, shiftMonth }
