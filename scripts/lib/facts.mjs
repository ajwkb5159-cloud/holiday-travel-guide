// 公开事实层：中文 Wikivoyage（主源，旅行向内容）+ 官方节假日安排。
// 中文 Wikipedia 在部分国内网络不可达，因此不再作为必需源；网络允许时可另行扩展。
//
// 目的不是替代 LLM，而是给它一份"带出处的底稿"：
// - 景点名、城市背景、节日日期以事实资料为准；
// - 票价/营业时间等易变信息不强行抓取，prompt 里要求写成区间或「以景区公告为准」。
//
// 所有请求都带 User-Agent、限速、超时；失败不抛到生成主流程，只记 warning。
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildHolidayWindow, parseMonthKey } from './holidays.mjs'

export const USER_AGENT = 'HolidayGuideBot/1.0 (+https://holidaytravel.vip.cpolar.cn; public-data verification)'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const truncate = (s, n) => {
  const t = stripTags(s)
  return t.length <= n ? t : t.slice(0, n) + '…'
}

export function loadPagesManifest(root) {
  const path = join(root, 'scripts', 'data', 'facts', 'pages.json')
  const doc = JSON.parse(readFileSync(path, 'utf-8'))
  if (!Array.isArray(doc.destinations) || doc.destinations.length === 0) {
    throw new Error(`事实清单为空或格式错误: ${path}`)
  }
  return doc
}

export function makeEmptyFacts(month, holidays = null) {
  return {
    month,
    generatedAt: new Date().toISOString(),
    holidays: holidays || buildHolidayWindow(month),
    destinations: {},
    sources: [],
    warnings: ['未获取到公开事实，已回退为纯 LLM 生成']
  }
}

/** 读取目标月 facts；没有则回退到最近一期，再没有返回 null。 */
export function loadFactsForMonth(dataRoot, month) {
  const exact = join(dataRoot, month, 'facts.json')
  if (existsSync(exact)) {
    try { return JSON.parse(readFileSync(exact, 'utf-8')) } catch { /* 坏文件继续回退 */ }
  }
  if (!existsSync(dataRoot)) return null
  const months = readdirSync(dataRoot)
    .filter(n => /^\d{6}$/.test(n) && n < month && existsSync(join(dataRoot, n, 'facts.json')))
    .sort()
  for (let i = months.length - 1; i >= 0; i--) {
    try {
      const doc = JSON.parse(readFileSync(join(dataRoot, months[i], 'facts.json'), 'utf-8'))
      console.log(`[facts] 目标月无事实文件，复用 ${months[i]} 的缓存`)
      return doc
    } catch { /* 继续 */ }
  }
  return null
}

export function writeFacts(outDir, facts) {
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, 'facts.json')
  writeFileSync(path, JSON.stringify(facts, null, 2), 'utf-8')
  return path
}

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`)
  return resp.json()
}

function wikiBase(lang, site) {
  return site === 'wikivoyage'
    ? `https://${lang}.wikivoyage.org/w/api.php`
    : `https://${lang}.wikipedia.org/w/api.php`
}

function resolveTitle(title, normalized, redirects) {
  let t = title
  for (let i = 0; i < 3; i++) {
    if (normalized.has(t)) t = normalized.get(t)
    if (redirects.has(t)) t = redirects.get(t)
  }
  return t
}

/** 批量抓取摘要（每批 ≤20 个标题），返回 { 原始标题: {title, extract, pageId, sourceUrl} | null } */
export async function fetchWikiBatch(titles, { lang = 'zh', site = 'wikipedia', timeoutMs = 15000 } = {}) {
  const unique = [...new Set(titles.filter(Boolean))]
  const out = {}
  for (let i = 0; i < unique.length; i += 20) {
    const batch = unique.slice(i, i + 20)
    const params = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      explaintext: '1',
      exsectionformat: 'plain',
      redirects: '1',
      format: 'json',
      formatversion: '2',
      titles: batch.join('|')
    })
    const data = await fetchJson(`${wikiBase(lang, site)}?${params}`, { timeoutMs })
    const pages = data?.query?.pages || []
    const normalized = new Map((data?.query?.normalized || []).map(x => [x.from, x.to]))
    const redirects = new Map((data?.query?.redirects || []).map(x => [x.from, x.to]))
    const byTitle = new Map(pages.map(p => [p.title, p]))
    const host = site === 'wikivoyage' ? `${lang}.wikivoyage.org` : `${lang}.wikipedia.org`
    for (const t of batch) {
      const p = byTitle.get(resolveTitle(t, normalized, redirects))
      out[t] = p && !p.missing && p.extract
        ? {
            title: p.title,
            extract: p.extract,
            pageId: p.pageid,
            sourceUrl: `https://${host}/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`
          }
        : null
    }
    if (i + 20 < unique.length) await sleep(250)
  }
  return out
}

const TIMOR_NAME_TO_SLUG = new Map([
  ['元旦', 'yuandan'], ['元旦节', 'yuandan'],
  ['春节', 'chunjie'], ['农历新年', 'chunjie'],
  ['清明节', 'qingming'], ['清明', 'qingming'],
  ['劳动节', 'laodong'], ['五一', 'laodong'],
  ['端午节', 'duanwu'], ['端午', 'duanwu'],
  ['中秋节', 'zhongqiu'], ['中秋', 'zhongqiu'],
  ['国庆节', 'guoqing'], ['国庆', 'guoqing']
])

/** 把 timor.tech 的按日数据转成 {slug:{days,isLegal}}。结构不匹配时返回 null。 */
export function legalSpansFromTimor(data) {
  const table = data?.holiday || data?.data?.holiday
  if (!table || typeof table !== 'object') return null
  const groups = new Map()
  for (const item of Object.values(table)) {
    if (!item || typeof item !== 'object') continue
    const name = String(item.name || '').replace(/\s+/g, '')
    const slug = TIMOR_NAME_TO_SLUG.get(name)
    if (!slug) continue
    if (item.holiday === false || item.holiday === 0) continue
    const date = String(item.date || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!groups.has(slug)) groups.set(slug, new Set())
    groups.get(slug).add(date)
  }
  // 官方安排未公布时，部分未来节日只返回 1 天；这类不完整数据不能覆盖默认天数
  const MIN_PLAUSIBLE_DAYS = { chunjie: 3, guoqing: 3, laodong: 3 }
  const spans = {}
  for (const [slug, dates] of groups) {
    if (MIN_PLAUSIBLE_DAYS[slug] && dates.size < MIN_PLAUSIBLE_DAYS[slug]) continue
    spans[slug] = { days: Math.min(10, Math.max(1, dates.size)), isLegal: 1 }
  }
  return Object.keys(spans).length ? spans : null
}

export async function fetchTimorYear(year, { timeoutMs = 12000 } = {}) {
  const data = await fetchJson(`https://timor.tech/api/holiday/year/${year}`, { timeoutMs })
  return legalSpansFromTimor(data)
}

/**
 * 抓取全部公开事实并组装 facts.json。
 * 任何单个页面/单个来源失败都只记 warning。
 */
export async function fetchAllFacts({ month, root, timeoutMs = 15000, delayMs = 250 } = {}) {
  const manifest = loadPagesManifest(root)
  const { year } = parseMonthKey(month)
  const warnings = []
  const sources = []
  const destinations = {}

  // 只取目标年份的官方安排：下一年度安排通常在年末才公布，提前拿来会得到不完整数据
  let legalSpans = null
  try {
    legalSpans = await fetchTimorYear(year, { timeoutMs })
    await sleep(delayMs)
  } catch (err) {
    warnings.push(`官方节假日 ${year} 抓取失败: ${String(err?.message ?? err)}`)
  }

  const holidays = buildHolidayWindow(month, { legalSpans: legalSpans || {} })
  if (legalSpans) sources.push('https://timor.tech/api/holiday/')

  for (const dest of manifest.destinations) {
    const record = {
      slug: dest.slug,
      name: dest.name,
      city: null,
      attractions: [],
      foods: dest.foods || [],
      sources: [],
      warnings: []
    }

    // 中文维基百科在部分网络环境下不可达；Wikivoyage 中文站更贴近旅行场景，作为主源。
    // 城市页常用简称（杭州）而不是行政全称（杭州市），两种都试。
    const cityTitles = [...new Set([dest.city, dest.city.replace(/[市省]$/, '')].filter(Boolean))]
    const titles = [...new Set([...cityTitles, ...(dest.attractions || [])])].filter(Boolean)
    let voyage = {}
    try {
      voyage = await fetchWikiBatch(titles, { site: 'wikivoyage', timeoutMs })
      await sleep(delayMs)
    } catch (err) {
      record.warnings.push(`Wikivoyage 抓取失败: ${String(err?.message ?? err)}`)
    }

    const cityPage = cityTitles.map(t => voyage[t]).find(Boolean)
    if (cityPage) {
      record.city = {
        title: cityPage.title,
        extract: truncate(cityPage.extract, 2000),
        sourceUrl: cityPage.sourceUrl
      }
      record.sources.push(cityPage.sourceUrl)
    } else {
      record.warnings.push(`Wikivoyage 页面缺失: ${cityTitles.join(' / ')}`)
    }

    for (const title of dest.attractions || []) {
      const item = voyage[title]
      if (!item) {
        record.warnings.push(`Wikivoyage 页面缺失: ${title}`)
        continue
      }
      record.attractions.push({
        title: item.title,
        extract: truncate(item.extract, 600),
        sourceUrl: item.sourceUrl
      })
      record.sources.push(item.sourceUrl)
    }

    destinations[dest.slug] = record
    sources.push(...record.sources)
    warnings.push(...record.warnings.map(w => `${dest.slug}: ${w}`))
  }

  return {
    month,
    generatedAt: new Date().toISOString(),
    holidays,
    legalSpans: legalSpans || {},
    destinations,
    sources: [...new Set(sources)],
    warnings
  }
}

/** 给 prompt 的事实块：控制在 ~1200 字以内，避免把上下文吃光。 */
export function factsPromptBlock(facts, destSlug) {
  const d = facts?.destinations?.[destSlug]
  if (!d) return ''
  const lines = []
  lines.push('【已核实资料（来自中文维基导游 Wikivoyage，仅作事实底稿）】')
  if (d.city?.extract) lines.push(`城市背景：${truncate(d.city.extract, 600)}`)
  if (d.voyage?.extract) lines.push(`旅行概览：${truncate(d.voyage.extract, 400)}`)
  const attractions = (d.attractions || []).slice(0, 6)
  if (attractions.length) {
    lines.push('景点资料：')
    for (const a of attractions) {
      lines.push(`- ${a.title}：${truncate(a.extract, 180)}`)
    }
  }
  if (d.foods?.length) lines.push(`代表美食：${d.foods.join('、')}`)
  lines.push('注意：票价、开放时间等易变信息若未明确出现在上方资料中，不得编造；写成区间并注明「以景区公告为准」。')
  return lines.join('\n')
}
