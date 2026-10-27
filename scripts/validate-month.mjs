// 月度数据闸门：投料前/发布后都能用，避免"文件存在但内容是坏的"被永久跳过。
//
// 用法：
//   node scripts/validate-month.mjs --month 202610
//   node scripts/validate-month.mjs --file F:\HolidayGuide\publish\updater\data\202610\guides.json --month 202610
//   node scripts/validate-month.mjs --month 202610 --require-version --strict-credits
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHolidayWindow } from './lib/holidays.mjs'
import { loadFactsForMonth } from './lib/facts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_ROOT = join(ROOT, 'HolidayGuideUpdater', 'data')
const PUBLIC_IMAGES = join(ROOT, 'holiday-travel-guide-web', 'public', 'images')

const EXPECTED_GUIDES = 120
const EXPECTED_PER_DEST = 10
const EXPECTED_HOLIDAYS = 10
const MIN_TEXT = 1800
const MAX_TEXT = 6000
const ALLOWED_LICENSE = /^(CC0|Public domain|CC BY(?:-SA)?(?:\s+\d+(?:\.\d+)?)?|PD)\b/i

function parseArgs(argv) {
  const args = {
    month: null, file: null, requireVersion: false, strictCredits: false, noImages: false, quiet: false
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--month') args.month = argv[++i]
    else if (a === '--file') args.file = argv[++i]
    else if (a === '--require-version') args.requireVersion = true
    else if (a === '--strict-credits') args.strictCredits = true
    else if (a === '--no-images') args.noImages = true
    else if (a === '--quiet') args.quiet = true
  }
  if (!args.month) {
    const d = new Date()
    args.month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return args
}

const stripHtml = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const coverPath = (url) => String(url || '').split('?')[0]

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const errors = []
  const warnings = []
  const guidesPath = args.file ? resolve(args.file) : join(DATA_ROOT, args.month, 'guides.json')

  if (!existsSync(guidesPath)) {
    console.error(`[validate] 找不到文件: ${guidesPath}`)
    process.exit(1)
  }

  let doc
  try {
    doc = loadJson(guidesPath)
  } catch (err) {
    console.error(`[validate] JSON 解析失败: ${err.message}`)
    process.exit(1)
  }

  const guides = Array.isArray(doc.guides) ? doc.guides : []
  const holidays = Array.isArray(doc.holidays) ? doc.holidays : []
  const facts = loadFactsForMonth(DATA_ROOT, args.month)
  // 只有同月 facts 里的节日日期才可信；跨月缓存可能还是上一期的窗口
  const expectedHolidays = facts?.month === args.month && facts?.holidays?.length === EXPECTED_HOLIDAYS
    ? facts.holidays
    : buildHolidayWindow(args.month)

  if (guides.length !== EXPECTED_GUIDES) errors.push(`攻略数量应为 ${EXPECTED_GUIDES}，实际 ${guides.length}`)
  if (holidays.length !== EXPECTED_HOLIDAYS) errors.push(`节日数量应为 ${EXPECTED_HOLIDAYS}，实际 ${holidays.length}`)

  const byDest = new Map()
  const ids = new Set()
  const holidayByName = new Map(expectedHolidays.map(h => [h.name, h]))

  for (const g of guides) {
    const id = String(g.externalId || '')
    if (!/^[a-z0-9-]{1,64}$/.test(id)) errors.push(`${id || '(空)'}: externalId 非法`)
    if (ids.has(id)) errors.push(`${id}: externalId 重复`)
    ids.add(id)

    const dest = id.split('-')[0]
    if (!byDest.has(dest)) byDest.set(dest, [])
    byDest.get(dest).push(g)

    const text = stripHtml(g.content)
    if (text.length < MIN_TEXT) errors.push(`${id}: 正文 ${text.length} 字 < ${MIN_TEXT}`)
    if (text.length > MAX_TEXT) errors.push(`${id}: 正文 ${text.length} 字 > ${MAX_TEXT}`)
    if ((String(g.content || '').match(/<h2[^>]*>/gi) || []).length < 6) errors.push(`${id}: h2 板块 < 6`)
    if (!String(g.content || '').includes('<table')) errors.push(`${id}: 缺少 table`)
    if (![3, 4, 5, 6, 7, 8].includes(Number(g.days))) errors.push(`${id}: days 非法 ${g.days}`)
    if (!Array.isArray(g.tags) || g.tags.length !== 3) errors.push(`${id}: tags 必须恰好 3 个`)
    if (!String(g.title || '').trim()) errors.push(`${id}: title 为空`)
    if (!String(g.summary || '').trim()) errors.push(`${id}: summary 为空`)

    const expected = holidayByName.get(g.holidayName)
    if (!expected) {
      errors.push(`${id}: holidayName「${g.holidayName}」不在目标月节日窗口内`)
    } else if (g.holidayDate !== expected.date) {
      errors.push(`${id}: ${g.holidayName} 日期应为 ${expected.date}，实际 ${g.holidayDate}`)
    }
    if (!Number.isFinite(Number(g.days)) || Number(g.days) !== expected?.days) {
      warnings.push(`${id}: days=${g.days}，节日窗口建议 ${expected?.days}`)
    }

    const cover = String(g.coverImage || '')
    if (!cover.startsWith('/images/destinations/')) errors.push(`${id}: 封面不是本地景点图: ${cover}`)
    if (/^https?:/i.test(cover)) errors.push(`${id}: 封面是外链: ${cover}`)
    if (/loremflickr|picsum/i.test(cover)) errors.push(`${id}: 封面仍是旧随机图: ${cover}`)
    if (args.requireVersion && !cover.includes(`?v=${args.month}`)) errors.push(`${id}: 封面缺少 ?v=${args.month}`)
  }

  for (const dest of byDest.keys()) {
    const count = byDest.get(dest).length
    if (count !== EXPECTED_PER_DEST) errors.push(`${dest}: 攻略数 ${count}，应为 ${EXPECTED_PER_DEST}`)
  }
  if (byDest.size !== 12) errors.push(`目的地数量应为 12，实际 ${byDest.size}`)

  const holidayNames = new Set()
  for (const h of holidays) {
    if (!h.name || !/^\d{4}-\d{2}-\d{2}$/.test(String(h.date || ''))) errors.push(`节日数据非法: ${JSON.stringify(h)}`)
    if (holidayNames.has(h.name)) errors.push(`节日重复: ${h.name}`)
    holidayNames.add(h.name)
    const expected = holidayByName.get(h.name)
    if (!expected) errors.push(`节日「${h.name}」不在目标月窗口内`)
    else if (h.date !== expected.date) errors.push(`节日 ${h.name} 日期应为 ${expected.date}，实际 ${h.date}`)
    if (!String(h.coverImage || '').startsWith('/images/holidays/')) errors.push(`节日 ${h.name} 封面不是本地图: ${h.coverImage}`)
  }

  // facts 交叉校验（跨月缓存只提示，不拿旧日期判错）
  if (facts && facts.month === args.month) {
    const factBySlug = new Map((facts.holidays || []).map(h => [h.slug, h]))
    for (const h of expectedHolidays) {
      const f = factBySlug.get(h.slug)
      if (!f) warnings.push(`facts 缺少节日 ${h.slug}`)
      else if (f.date !== h.date) errors.push(`facts 节日 ${h.slug} 日期 ${f.date} 与窗口 ${h.date} 不一致`)
    }
  } else if (facts) {
    warnings.push(`facts.month=${facts.month} 与目标月 ${args.month} 不一致（复用缓存，跳过节日交叉校验）`)
  } else {
    warnings.push('未找到 facts.json，本次只做结构校验')
  }

  // 署名/图片文件校验
  const creditsPath = join(PUBLIC_IMAGES, 'credits.json')
  const credits = existsSync(creditsPath) ? loadJson(creditsPath) : null
  const creditMap = new Map((credits?.images || []).map(x => [coverPath(x.path), x]))
  const allCovers = [...new Set([...guides.map(g => coverPath(g.coverImage)), ...holidays.map(h => coverPath(h.coverImage))])]

  for (const cover of allCovers) {
    if (!args.noImages) {
      const file = join(PUBLIC_IMAGES, cover.replace(/^\/images\//, ''))
      if (!existsSync(file)) errors.push(`本地图片不存在: ${cover}`)
    }
    if (credits) {
      const credit = creditMap.get(cover)
      if (!credit) {
        const msg = `缺少图片署名: ${cover}`
        if (args.strictCredits) errors.push(msg)
        else warnings.push(msg)
      } else if (!ALLOWED_LICENSE.test(String(credit.license || ''))) {
        errors.push(`图片许可不在白名单: ${cover} → ${credit.license}`)
      } else if (!String(credit.sourcePage || '').startsWith('http')) {
        errors.push(`图片署名缺少来源页: ${cover}`)
      }
    }
  }
  if (!credits) {
    const msg = '未找到 public/images/credits.json，无法校验署名'
    if (args.strictCredits) errors.push(msg)
    else warnings.push(msg)
  }
  if (credits && allCovers.length !== creditMap.size) {
    warnings.push(`credits 条目 ${creditMap.size} 与封面数 ${allCovers.length} 不一致（可能含旧图条目）`)
  }

  if (!args.quiet) {
    console.log(`[validate] 文件: ${guidesPath}`)
    console.log(`[validate] 攻略 ${guides.length} / 节日 ${holidays.length} / 封面 ${allCovers.length} / facts ${facts ? '有' : '无'}`)
    for (const w of warnings.slice(0, 20)) console.warn(`  [warn] ${w}`)
    if (warnings.length > 20) console.warn(`  [warn] ... 另有 ${warnings.length - 20} 条`)
  }

  if (errors.length) {
    console.error(`[validate] 失败 ${errors.length} 项：`)
    for (const e of errors.slice(0, 50)) console.error(`  - ${e}`)
    if (errors.length > 50) console.error(`  - ... 另有 ${errors.length - 50} 项`)
    process.exit(1)
  }
  console.log('[validate] 全部通过 ✓')
}

main()
