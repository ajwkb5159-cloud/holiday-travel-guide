// 月度景点图刷新：Wikimedia Commons 搜索 → 许可过滤 → 800px JPEG 下载 → 本地缓存 + 署名清单。
//
// 用法：
//   node scripts/refresh-images.mjs --month 202610 --dry-run
//   node scripts/refresh-images.mjs --month 202610 --only beijing
//   node scripts/refresh-images.mjs --month 202610 --sync-prod
//   node scripts/refresh-images.mjs --month 202610 --strict
//
// 设计：
// - 只接受 JPEG 原图 + 明确允许的许可（CC0/PD/CC BY/CC BY-SA），拒绝 NC/ND/GFDL/non-free；
// - 同城 10 个 slot 用「月份 + slot」做确定性轮换，跨月换图但不会随机崩；
// - 下载失败保留旧图，默认不阻断月度数据生成；
// - 署名写入 public/images/credits.json + CREDITS.md，前端详情页/汇总页读取。
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_IMAGES = join(ROOT, 'holiday-travel-guide-web', 'public', 'images')
const CACHE_DIR = join(ROOT, '.test-env', 'commons-cache')
const BACKEND_WWWROOT = join(ROOT, 'HolidayGuideBackend', 'wwwroot', 'images')
const DEFAULT_PROD_WWWROOT = 'F:\\HolidayGuide\\publish\\backend\\wwwroot\\images'
const USER_AGENT = 'HolidayGuideImageBot/1.0 (+https://holidaytravel.vip.cpolar.cn; monthly cover refresh)'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const sha1 = (s) => createHash('sha1').update(String(s)).digest('hex')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function parseArgs(argv) {
  const args = {
    month: null, only: null, dryRun: false, force: false, strict: false,
    syncProd: false, prodWwwroot: DEFAULT_PROD_WWWROOT, refreshCache: false,
    delay: 300, timeout: 20000
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--month') args.month = argv[++i]
    else if (a === '--only') args.only = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--force') args.force = true
    else if (a === '--strict') args.strict = true
    else if (a === '--sync-prod') args.syncProd = true
    else if (a === '--prod-wwwroot') args.prodWwwroot = argv[++i]
    else if (a === '--refresh-cache') args.refreshCache = true
    else if (a === '--delay') args.delay = Number(argv[++i])
    else if (a === '--timeout') args.timeout = Number(argv[++i])
  }
  if (!args.month) {
    const d = new Date()
    args.month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return args
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function isAllowedLicense(license) {
  const s = String(license || '').trim()
  if (!s) return false
  if (/GFDL|non[- ]?free|fair use|CC BY-NC|CC BY-ND|\bNC\b|\bND\b/i.test(s)) return false
  return /^(CC0|Public domain|CC BY(?:-SA)?|PD\b)/i.test(s)
}

// Commons 搜索经常把“地铁站/酒店/海外同名校区/别国节日”排到前面；直接过滤，宁可保留旧图
const REJECT_TITLE = /\bstation\b|\bmetro\b|railway|airport|\bhotel\b|malaysia|thailand|\bbeef\b|\bbear\b|\bgoa\b|kolkata|\btram\b|\bplatform\b|cochrane|\bmap\b|guide map|导览图|示意图|地图|consumer fair|trade expo|一宮|祭り|tanabata|ikenob|\bbus\b|shuttle|tourist center|tourrist center/i

function isRejectedTitle(title) {
  return REJECT_TITLE.test(String(title || ''))
}

async function fetchJson(url, { timeoutMs }) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

function commonsCandidate(page) {
  const ii = page?.imageinfo?.[0]
  if (!ii) return null
  if (ii.mime !== 'image/jpeg') return null
  if (!(Number(ii.width) >= 800 && Number(ii.height) >= 500)) return null
  const meta = ii.extmetadata || {}
  const license = stripHtml(meta.LicenseShortName?.value || '')
  if (!isAllowedLicense(license)) return null
  const title = String(page.title || '').replace(/^File:/, '')
  if (!title) return null
  const downloadUrl = ii.thumburl || ii.url
  if (!downloadUrl) return null
  return {
    title,
    label: decryptLabel(meta.ObjectName?.value),
    artist: stripHtml(meta.Artist?.value || meta.Credit?.value || 'Unknown').slice(0, 120) || 'Unknown',
    license,
    licenseUrl: String(meta.LicenseUrl?.value || 'https://commons.wikimedia.org/wiki/Commons:Licensing'),
    description: stripHtml(meta.ImageDescription?.value || '').slice(0, 200),
    sourcePage: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title.replace(/ /g, '_'))}`,
    downloadUrl,
    width: Number(ii.width),
    height: Number(ii.height)
  }
}

function decryptLabel(v) { return stripHtml(v).slice(0, 160) }

async function searchCommons(query, args) {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cacheFile = join(CACHE_DIR, `${sha1(query)}.json`)
  if (!args.refreshCache && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'))
      // 空候选不入缓存命中：可能只是当时网络抖动/搜索无结果，下次应重新请求
      if ((cached.candidates || []).length && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
        return cached.candidates.filter(c => !isRejectedTitle(c.title))
      }
    } catch { /* 坏缓存重建 */ }
  }

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '25',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '800',
    format: 'json',
    formatversion: '2'
  })
  const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, { timeoutMs: args.timeout })
  const pages = data?.query?.pages || []
  const candidates = pages.map(commonsCandidate).filter(Boolean).filter(c => !isRejectedTitle(c.title))
  writeFileSync(cacheFile, JSON.stringify({ query, fetchedAt: new Date().toISOString(), candidates }, null, 2), 'utf-8')
  return candidates
}

async function searchWithFallback(task, args) {
  const fallbacks = task.group === 'holidays'
    ? [`${task.query} China`, `${task.label} festival`, `${task.label} China`]
    : [`${task.query} China`, `${task.cityName} ${task.label}`]
  const queries = [...new Set([task.query, ...fallbacks].filter(Boolean))]
  for (const query of queries) {
    const candidates = await searchCommons(query, args)
    await sleep(args.delay)
    if (candidates.length) return { candidates, query }
  }
  return { candidates: [], query: task.query }
}

function pickCandidate(candidates, seed, usedTitles) {
  if (!candidates.length) return null
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[(seed + i) % candidates.length]
    if (!usedTitles.has(c.title)) return c
  }
  return candidates[seed % candidates.length]
}

async function downloadJpeg(url, destFile, args) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(args.timeout)
  })
  if (!resp.ok) throw new Error(`下载 HTTP ${resp.status}`)
  const type = resp.headers.get('content-type') || ''
  if (!type.includes('image/jpeg')) throw new Error(`非 JPEG: ${type}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  if (buf.length < 20 * 1024) throw new Error(`图片过小: ${buf.length} bytes`)
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw new Error('JPEG magic 校验失败')
  mkdirSync(dirname(destFile), { recursive: true })
  const tmp = `${destFile}.tmp-${process.pid}`
  writeFileSync(tmp, buf)
  renameSync(tmp, destFile)
  return { bytes: buf.length, sha256: sha256(buf) }
}

function loadCredits() {
  const file = join(PUBLIC_IMAGES, 'credits.json')
  if (!existsSync(file)) return new Map()
  try {
    const doc = JSON.parse(readFileSync(file, 'utf-8'))
    return new Map((doc.images || []).map(x => [x.path, x]))
  } catch { return new Map() }
}

function writeCredits(month, credits) {
  const images = [...credits.values()].sort((a, b) => a.path.localeCompare(b.path))
  const doc = { month, generatedAt: new Date().toISOString(), images }
  writeFileSync(join(PUBLIC_IMAGES, 'credits.json'), JSON.stringify(doc, null, 2), 'utf-8')
  writeFileSync(join(PUBLIC_IMAGES, 'CREDITS.md'), renderCreditsMarkdown(month, images), 'utf-8')
  return doc
}

function renderCreditsMarkdown(month, images) {
  const lines = [
    '# Image Credits',
    '',
    `> 更新月份：${month}。图片来自 [Wikimedia Commons](https://commons.wikimedia.org/)，`,
    '> 仅使用 CC0 / Public Domain / CC BY / CC BY-SA 许可；逐图署名与许可链接见下表。',
    '',
    '| 用途 | 本地文件 | 作者 | 许可 | 来源页 |',
    '|------|----------|------|------|--------|',
    ...images.map(x => `| ${x.group === 'holidays' ? '节日' : '城市'} · ${x.slug} · ${x.slot || 1} | \`${x.path}\` | ${x.artist || 'Unknown'} | ${x.license || 'Unknown'} | ${x.sourcePage || ''} |`)
  ]
  return lines.join('\n') + '\n'
}

function syncImages(args) {
  if (!existsSync(PUBLIC_IMAGES)) return []
  const targets = [BACKEND_WWWROOT]
  if (args.syncProd && args.prodWwwroot) targets.push(args.prodWwwroot)
  const done = []
  for (const target of targets) {
    try {
      mkdirSync(target, { recursive: true })
      cpSync(PUBLIC_IMAGES, target, { recursive: true, force: true })
      done.push(target)
    } catch (err) {
      console.warn(`[images] 同步失败 ${target}: ${err.message}`)
    }
  }
  return done
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts', 'data', 'image-manifest.json'), 'utf-8'))
  const credits = loadCredits()
  const monthNum = Number(args.month.slice(4, 6)) || 1
  const report = { month: args.month, generatedAt: new Date().toISOString(), dryRun: args.dryRun, results: [], warnings: [] }

  const tasks = []
  for (const city of manifest.attractions) {
    if (args.only && args.only !== city.slug) continue
    for (const slot of city.slots) {
      tasks.push({
        group: 'destinations', slug: city.slug, cityName: city.name, slot: slot.slot, label: slot.label, query: slot.query,
        path: `/images/destinations/${city.slug}-${String(slot.slot).padStart(2, '0')}.jpg`,
        file: join(PUBLIC_IMAGES, 'destinations', `${city.slug}-${String(slot.slot).padStart(2, '0')}.jpg`),
        seed: monthNum * 7 + slot.slot
      })
    }
  }
  for (const h of manifest.holidays) {
    if (args.only && args.only !== h.slug) continue
    tasks.push({
      group: 'holidays', slug: h.slug, cityName: h.name, slot: 1, label: h.name, query: h.query,
      path: `/images/holidays/${h.slug}.jpg`,
      file: join(PUBLIC_IMAGES, 'holidays', `${h.slug}.jpg`),
      seed: monthNum * 5 + 3
    })
  }

  console.log(`[images] 月份 ${args.month}，任务 ${tasks.length} 个${args.dryRun ? '（dry-run，不下载）' : ''}`)

  const usedTitlesByGroup = new Map()
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const key = task.group === 'destinations' ? `d:${task.slug}` : `h:${task.slug}`
    if (!usedTitlesByGroup.has(key)) usedTitlesByGroup.set(key, new Set())
    const used = usedTitlesByGroup.get(key)
    const prev = credits.get(task.path)
    let result = { ...task, status: 'pending' }

    try {
      const { candidates, query: usedQuery } = await searchWithFallback(task, args)
      if (!candidates.length) throw new Error('没有符合许可/尺寸的 JPEG 候选')
      const picked = pickCandidate(candidates, task.seed, used)
      used.add(picked.title)

      if (args.dryRun) {
        result = {
          ...result,
          status: 'dry-run',
          query: usedQuery,
          candidate: { title: picked.title, artist: picked.artist, license: picked.license, sourcePage: picked.sourcePage },
          candidateCount: candidates.length
        }
      } else if (!args.force && prev?.title === picked.title && existsSync(task.file)) {
        result = { ...result, status: 'kept-same', query: usedQuery, title: picked.title, artist: prev.artist, license: prev.license }
      } else {
        const dl = await downloadJpeg(picked.downloadUrl, task.file, args)
        await sleep(args.delay)
        const entry = {
          path: task.path,
          group: task.group,
          slug: task.slug,
          cityName: task.cityName,
          slot: task.slot,
          label: task.label,
          title: picked.title,
          artist: picked.artist,
          license: picked.license,
          licenseUrl: picked.licenseUrl,
          sourcePage: picked.sourcePage,
          downloadUrl: picked.downloadUrl,
          width: picked.width,
          height: picked.height,
          sha256: dl.sha256,
          bytes: dl.bytes
        }
        credits.set(task.path, entry)
        result = { ...result, status: 'downloaded', query: usedQuery, title: picked.title, artist: picked.artist, license: picked.license, bytes: dl.bytes }
      }
    } catch (err) {
      const msg = String(err?.message ?? err)
      report.warnings.push(`${task.path}: ${msg}`)
      if (prev) credits.set(task.path, prev)
      result = { ...result, status: 'kept-existing', error: msg, title: prev?.title, license: prev?.license }
    }

    report.results.push(result)
    const icon = result.status === 'downloaded' ? '↓' : result.status === 'dry-run' ? '?' : result.status === 'kept-same' ? '=' : '!'
    console.log(`[${i + 1}/${tasks.length}] ${icon} ${task.path} <- ${result.title || result.candidate?.title || '(keep)'} ${result.license || result.candidate?.license || ''}`)
  }

  if (!args.dryRun) {
    writeCredits(args.month, credits)
    const synced = syncImages(args)
    report.synced = synced
    console.log(`[images] credits.json / CREDITS.md 已更新；同步 ${synced.length} 个目录`)
  }

  mkdirSync(join(ROOT, '.test-env'), { recursive: true })
  const reportPath = join(ROOT, '.test-env', `image-refresh-${args.month}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  const failed = report.results.filter(r => r.status === 'kept-existing').length
  console.log(`[images] 完成：下载 ${report.results.filter(r => r.status === 'downloaded').length}，同图 ${report.results.filter(r => r.status === 'kept-same').length}，保留旧图 ${failed}；报告 ${reportPath}`)
  if (failed) {
    console.warn('[images] 部分图片保留旧图（详见报告）；默认不阻断数据生成')
    if (args.strict) process.exit(1)
  }
}

main().catch(err => {
  console.error('[images] 致命错误:', err)
  process.exit(1)
})
