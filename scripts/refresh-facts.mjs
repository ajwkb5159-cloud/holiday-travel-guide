// 月度公开事实刷新：中文 Wikivoyage（主源）/ 官方节假日安排 → data/{yyyyMM}/facts.json
//
// 用法：
//   node scripts/refresh-facts.mjs [--month yyyyMM] [--timeout 15000] [--strict] [--offline]
// 说明：
//   - 默认失败不阻断月度生成：保留已有 facts，或写空事实并退出 0；
//   - --strict 时失败退出 1；
//   - --offline 不联网，仅用已有 facts 或空事实（用于离线演练）。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fetchAllFacts, loadFactsForMonth, makeEmptyFacts, writeFacts
} from './lib/facts.mjs'
import { buildHolidayWindow } from './lib/holidays.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_ROOT = join(ROOT, 'HolidayGuideUpdater', 'data')

function parseArgs(argv) {
  const args = { month: null, timeout: 15000, strict: false, offline: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--month') args.month = argv[++i]
    else if (a === '--timeout') args.timeout = Number(argv[++i])
    else if (a === '--strict') args.strict = true
    else if (a === '--offline') args.offline = true
  }
  if (!args.month) {
    const d = new Date()
    args.month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return args
}

function currentHolidays(month) {
  try { return buildHolidayWindow(month) } catch { return [] }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = join(DATA_ROOT, args.month)
  console.log(`[facts] 目标月份 ${args.month}，输出 ${join(outDir, 'facts.json')}`)

  if (args.offline) {
    const existing = loadFactsForMonth(DATA_ROOT, args.month)
    if (existing) {
      console.log('[facts] --offline：复用已有 facts，不联网')
      process.exit(0)
    }
    const path = writeFacts(outDir, makeEmptyFacts(args.month, currentHolidays(args.month)))
    console.log(`[facts] --offline：无已有 facts，写空事实 → ${path}`)
    process.exit(0)
  }

  try {
    const facts = await fetchAllFacts({ month: args.month, root: ROOT, timeoutMs: args.timeout })
    const path = writeFacts(outDir, facts)
    const destCount = Object.keys(facts.destinations || {}).length
    const attractionCount = Object.values(facts.destinations || {})
      .reduce((n, d) => n + (d.attractions?.length || 0), 0)
    console.log(`[facts] 已写入 ${destCount} 个目的地 / ${attractionCount} 个景点摘要 / ${facts.holidays.length} 个节日`)
    console.log(`[facts] 节日：${facts.holidays.map(h => `${h.name} ${h.date}`).join(' | ')}`)
    if (facts.warnings?.length) {
      console.warn(`[facts] ${facts.warnings.length} 条 warning（前 8 条）：`)
      for (const w of facts.warnings.slice(0, 8)) console.warn(`  - ${w}`)
    }
    console.log(`[facts] 输出 ${path}`)
    process.exit(0)
  } catch (err) {
    console.error(`[facts] 抓取失败: ${String(err?.message ?? err)}`)
    const existing = loadFactsForMonth(DATA_ROOT, args.month)
    if (existing) {
      console.warn('[facts] 保留已有 facts，月度生成继续')
      process.exit(0)
    }
    if (args.strict) {
      console.error('[facts] --strict：无可用事实，退出 1')
      process.exit(1)
    }
    const path = writeFacts(outDir, makeEmptyFacts(args.month, currentHolidays(args.month)))
    console.warn(`[facts] 写空事实并继续 → ${path}`)
    process.exit(0)
  }
}

main().catch(err => {
  console.error('[facts] 致命错误:', err)
  process.exit(1)
})
