// 离线回归：节日窗口必须锁定历史行为，并对跨年/闰月/边界月份正确滚动。
// 运行：node scripts/test-holidays.mjs
import assert from 'node:assert/strict'
import { buildHolidayWindow, assertHolidayWindow, HOLIDAY_DEFS } from './lib/holidays.mjs'

const EXPECTED_202610 = {
  qixi: '2026-08-19',
  zhongqiu: '2026-09-25',
  guoqing: '2026-10-01',
  chongyang: '2026-10-18',
  shengdan: '2026-12-25',
  yuandan: '2027-01-01',
  chunjie: '2027-02-06',
  qingming: '2027-04-05',
  laodong: '2027-05-01',
  duanwu: '2027-06-09'
}

function checkWindow(monthKey, expected) {
  const holidays = buildHolidayWindow(monthKey)
  const result = assertHolidayWindow(holidays, expected)
  assert.equal(result.ok, true, `${monthKey} 校验失败: ${result.errors.join('; ')}`)
  assert.equal(holidays.length, HOLIDAY_DEFS.length)
  assert.equal(new Set(holidays.map(h => h.slug)).size, HOLIDAY_DEFS.length)
  return holidays
}

// 1) 202610：必须与历史数据完全一致（含封面索引顺序）
checkWindow('202610', EXPECTED_202610)

// 2) 跨年滚动：202612 的七夕应落到 2027-08-08，而不是 2026 年
const dec = checkWindow('202612', {
  qixi: '2027-08-08',
  chunjie: '2027-02-06',
  duanwu: '2027-06-09'
})
assert.equal(dec.find(h => h.slug === 'zhongqiu').date, '2026-09-25')

// 3) 年初窗口：春节 2026-02-17，端午 2026-06-19
checkWindow('202601', {
  chunjie: '2026-02-17',
  qingming: '2026-04-05',
  duanwu: '2026-06-19'
})

// 4) 闰月回归：2025 年闰六月，七夕仍必须是 7 月 7（2025-08-29），不能落进闰六月
const leap = checkWindow('202508', { qixi: '2025-08-29' })
assert.notEqual(leap.find(h => h.slug === 'qixi').date, '2025-07-31')

// 5) 反向断言：错误日期必须被 assert 抓住
const bad = assertHolidayWindow(buildHolidayWindow('202610'), { qixi: '2026-08-20' })
assert.equal(bad.ok, false)
assert.match(bad.errors.join(' '), /qixi 日期应为 2026-08-20/)

// 6) 非法月份必须报错
assert.throws(() => buildHolidayWindow('2026-10'), /月份格式/)
assert.throws(() => buildHolidayWindow('202613'), /月份非法/)

console.log('[test-holidays] 全部通过 ✓')
console.log('[test-holidays] 202610 =', Object.entries(EXPECTED_202610).map(([k, v]) => `${k}:${v}`).join(' | '))
