// 只读浏览器审计：逐页路由 + 接口 + CSS 背景图真实加载 + 断图兜底 + 截图
// 用法：
//   node scripts/audit-images.mjs --base http://127.0.0.1:5099 --out .test-env/audit-20261025
//   node scripts/audit-images.mjs --base http://127.0.0.1:5201 --block-images
// 说明：
//   - 只发 GET，不写库、不调 /api/update/*；
//   - 封面是 CSS background-image，无法挂 onerror，这里用页面内 new Image() 真实探测；
//   - --block-images 会拦截 loremflickr/picsum，用于验证季节渐变/背景色兜底；
//   - 报告与截图写到 --out 目录。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(join(ROOT, 'holiday-travel-guide-web', 'node_modules', 'playwright-core'))

const args = process.argv.slice(2)
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const BASE = argVal('--base', 'http://127.0.0.1:5199')
const OUT = join(ROOT, argVal('--out', join('.test-env', 'audit-' + new Date().toISOString().slice(0, 10))))
const BLOCK = args.includes('--block-images')
const PUBLIC_BASE = argVal('--public-base', '')
const SHOTS = join(OUT, BLOCK ? 'shots-blocked' : 'shots')
const MOBILE = join(OUT, BLOCK ? 'shots-blocked-mobile' : 'shots-mobile')
mkdirSync(SHOTS, { recursive: true })
mkdirSync(MOBILE, { recursive: true })

const imageCache = new Map()
const report = {
  base: BASE,
  publicBase: PUBLIC_BASE || null,
  blocked: BLOCK,
  startedAt: new Date().toISOString(),
  pages: [],
  api: {},
  images: [],
  stats: null,
  interactions: {},
  mobile: [],
  publicSite: null
}

function failText(e) { return String(e && e.message ? e.message : e).slice(0, 240) }

async function makePage(browser, viewport, blockImages) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.setDefaultTimeout(25000)
  page.setDefaultNavigationTimeout(30000)
  const logs = { console: [], pageErrors: [], requestFailed: [], badResponses: [] }
  page.on('console', m => {
    if (m.type() === 'error') logs.console.push({ text: m.text().slice(0, 300), url: m.location()?.url || '' })
  })
  page.on('pageerror', e => logs.pageErrors.push(failText(e)))
  page.on('requestfailed', r => logs.requestFailed.push({ url: r.url().slice(0, 300), error: r.failure()?.errorText || '' }))
  page.on('response', r => {
    if (r.status() >= 400) logs.badResponses.push({ url: r.url().slice(0, 300), status: r.status() })
  })
  if (blockImages) await ctx.route(/loremflickr\.com|picsum\.photos/i, r => r.abort())
  return { ctx, page, logs }
}

async function visit(page, path, { wait = 2200, fullPage = false, shotName = '' } = {}) {
  const started = Date.now()
  const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(wait)
  const info = await page.evaluate(() => ({
    title: document.title,
    href: location.href,
    guideCards: document.querySelectorAll('.guide-card').length,
    destCards: document.querySelectorAll('.dest-card').length,
    destChips: document.querySelectorAll('.dest-chip').length,
    holidayCards: document.querySelectorAll('.holiday-card, .holiday-item, .countdown-card, .holiday-row').length,
    tagChips: document.querySelectorAll('.el-tag').length,
    footer: (document.querySelector('.app-footer')?.innerText || '').replace(/\s+\n/g, '\n').trim().slice(0, 600),
    hasOverlay: !!document.querySelector('.maintenance-overlay'),
    hasAiBall: !!document.querySelector('.ai-ball'),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    bodyHeight: document.body.scrollHeight
  }))
  if (shotName) {
    await page.screenshot({ path: join(SHOTS, shotName + '.png'), fullPage }).catch(() => {})
  }
  return { path, status: resp ? resp.status() : null, ms: Date.now() - started, ...info }
}

async function collectBackgrounds(page) {
  return await page.evaluate(() => {
    const rows = []
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      const bgi = cs.backgroundImage
      if (!bgi || bgi === 'none') continue
      const urls = [...bgi.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
        .map(m => m[1])
        .filter(u => /^https?:\/\//i.test(u))
      if (!urls.length) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      rows.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 100),
        urls: [...new Set(urls)],
        backgroundColor: cs.backgroundColor,
        hasGradient: /gradient/i.test(bgi),
        w: Math.round(r.width),
        h: Math.round(r.height)
      })
    }
    return rows
  })
}

async function probeUrls(page, urls) {
  if (!urls.length) return []
  return await page.evaluate(async ({ urls, timeoutMs, concurrency }) => {
    const out = []
    let cursor = 0
    async function load(url) {
      const t0 = performance.now()
      return await new Promise(resolve => {
        const img = new Image()
        let settled = false
        const finish = (ok, extra) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ url, ok, ms: Math.round(performance.now() - t0), ...extra })
        }
        const timer = setTimeout(() => { img.src = ''; finish(false, { error: 'timeout' }) }, timeoutMs)
        img.onload = () => finish(true, { width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => finish(false, { error: 'error' })
        img.src = url
      })
    }
    async function worker() {
      while (cursor < urls.length) {
        const url = urls[cursor++]
        out.push(await load(url))
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
    return out
  }, { urls, timeoutMs: 10000, concurrency: 8 })
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

function summarizeImages(items) {
  const ok = items.filter(x => x.ok)
  const failed = items.filter(x => !x.ok)
  const byDomain = {}
  for (const x of items) {
    let host = 'invalid'
    try { host = new URL(x.url).hostname } catch { /* keep */ }
    byDomain[host] = byDomain[host] || { total: 0, ok: 0, failed: 0 }
    byDomain[host].total++
    if (x.ok) byDomain[host].ok++; else byDomain[host].failed++
  }
  const okMs = ok.map(x => x.ms)
  return {
    total: items.length,
    ok: ok.length,
    failed: failed.length,
    successRate: items.length ? +(ok.length / items.length * 100).toFixed(1) : null,
    p50ms: percentile(okMs, 50),
    p95ms: percentile(okMs, 95),
    maxMs: okMs.length ? Math.max(...okMs) : null,
    byDomain,
    failedUrls: failed.slice(0, 30).map(x => ({ url: x.url, error: x.error, ms: x.ms }))
  }
}

async function auditPageImages(page, rows, blocked) {
  const urls = [...new Set(rows.flatMap(r => r.urls))]
  if (!blocked) {
    const missing = urls.filter(u => !imageCache.has(u))
    if (missing.length) {
      const probed = await probeUrls(page, missing)
      for (const item of probed) imageCache.set(item.url, item)
    }
  }
  const results = urls.map(u => blocked
    ? { url: u, ok: false, blocked: true, ms: 0, error: 'blocked-by-audit' }
    : imageCache.get(u))
  const fallbackVisible = rows.map(r => ({
    cls: r.cls,
    urls: r.urls,
    backgroundColor: r.backgroundColor,
    hasGradient: r.hasGradient,
    hasOpaqueFallback: !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(r.backgroundColor)
  }))
  return { urls, results, fallbackVisible }
}

async function auditApi(page) {
  return await page.evaluate(async (base) => {
    const paths = [
      '/api/system/status',
      '/api/guide/home',
      '/api/guide?page=1&size=2',
      '/api/guide/ranking?type=hot&limit=5',
      '/api/guide/seasonal?limit=5',
      '/api/destination',
      '/api/holiday',
      '/api/holiday/countdown?days=60',
      '/api/tag?limit=10',
      '/api/search?q=' + encodeURIComponent('北京') + '&limit=5',
      '/api/search/suggest?q=' + encodeURIComponent('北') + '&limit=5',
      '/api/guide/recommend?destinations=' + encodeURIComponent('北京') + '&limit=5',
      '/api/ai/status',
      '/api/ai/quota',
      '/api/update/status',
      '/api/nonexistent-xyz'
    ]
    const out = {}
    for (const p of paths) {
      try {
        const r = await fetch(base + p, { headers: { Accept: 'application/json' } })
        const text = await r.text()
        let json = null
        try { json = JSON.parse(text) } catch { /* non-json */ }
        out[p] = {
          status: r.status,
          code: json && 'Code' in json ? json.Code : null,
          msg: json && 'Msg' in json ? json.Msg : null,
          data: json ? json.Data : undefined,
          body: json ? undefined : text.slice(0, 200)
        }
      } catch (e) {
        out[p] = { error: String(e).slice(0, 200) }
      }
    }
    return out
  }, BASE)
}

async function realGuideIds(page, size = 2) {
  return await page.evaluate(async ({ base, n }) => {
    const r = await fetch(base + '/api/guide?page=1&size=' + n).then(x => x.json())
    return (r.Data && r.Data.Items ? r.Data.Items : []).map(x => x.Id)
  }, { base: BASE, n: size })
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const { ctx, page, logs } = await makePage(browser, { width: 1440, height: 900 }, BLOCK)
  console.log(`[audit] base=${BASE} blocked=${BLOCK} out=${OUT}`)

  const desktopRoutes = [
    ['/', 'home', { fullPage: true }],
    ['/guides', 'guides', { fullPage: true }],
    ['/guides?sort=latest', 'guides-latest'],
    ['/guides?holidayName=' + encodeURIComponent('中秋节'), 'guides-holiday'],
    ['/destinations', 'destinations'],
    ['/destinations/' + encodeURIComponent('北京'), 'destination-beijing'],
    ['/holidays', 'holidays'],
    ['/tags', 'tags'],
    ['/search?q=' + encodeURIComponent('北京'), 'search-beijing'],
    ['/search?q=' + encodeURIComponent('杭州'), 'search-hangzhou'],
    ['/favorites', 'favorites-empty']
  ]

  // 详情页 id 先取，避免详情单独异常影响整轮
  let detailIds = []
  try { detailIds = await realGuideIds(page, 2) } catch (e) { logs.pageErrors.push('realGuideIds: ' + failText(e)) }
  if (detailIds.length) desktopRoutes.push([`/guides/${detailIds[0]}`, 'guide-detail', { fullPage: true }])

  for (const [path, name, opts] of desktopRoutes) {
    try {
      const info = await visit(page, path, { shotName: name, ...(opts || {}) })
      const rows = await collectBackgrounds(page)
      const imgs = await auditPageImages(page, rows, BLOCK)
      info.backgrounds = rows.length
      info.imageUrls = imgs.urls.length
      info.imageResults = imgs.results
      info.fallbackVisible = imgs.fallbackVisible
      report.pages.push(info)
      const failed = imgs.results.filter(x => !x.ok).length
      console.log(`  ${info.status === 200 ? '✓' : '✗'} ${path} HTTP ${info.status} cards=${info.guideCards} images=${imgs.urls.length} failed=${failed}`)
    } catch (e) {
      report.pages.push({ path, error: failText(e) })
      console.log(`  ✗ ${path} ERROR ${failText(e)}`)
    }
  }

  // 接口全量
  try {
    report.api = await auditApi(page)
    const st = report.api['/api/system/status']?.data
    if (st) console.log(`[status] ${JSON.stringify(st)}`)
  } catch (e) { report.api = { error: failText(e) } }

  // 交互只读：搜索高亮、收藏、AI 悬浮窗
  try {
    await page.goto(BASE + '/search?q=' + encodeURIComponent('北京'), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1800)
    report.interactions.search = await page.evaluate(() => ({
      cards: document.querySelectorAll('.guide-card').length,
      highlights: document.querySelectorAll('em.hl').length,
      url: location.href
    }))
    await page.goto(BASE + '/guides?sort=latest', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1800)
    report.interactions.sort = await page.evaluate(() => ({
      cards: document.querySelectorAll('.guide-card').length,
      url: location.href,
      active: document.querySelector('.sort-active, .is-active')?.innerText || ''
    }))

    const ids = await realGuideIds(page, 2)
    if (ids.length) {
      await page.evaluate((list) => {
        localStorage.setItem('holiday-guide-favorites', JSON.stringify(list.map((id, i) => ({ id, addedAt: Date.now() - i * 1000 }))))
      }, ids)
      await page.goto(BASE + '/favorites', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2200)
      report.interactions.favorites = await page.evaluate(() => ({
        cards: document.querySelectorAll('.guide-card').length,
        empty: !!document.querySelector('.empty-state, .el-empty')
      }))
      await page.screenshot({ path: join(SHOTS, 'favorites-filled.png') }).catch(() => {})
      await page.evaluate(() => localStorage.removeItem('holiday-guide-favorites'))
    }

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1800)
    const ball = page.locator('.ai-ball').first()
    const ballVisible = await ball.isVisible().catch(() => false)
    let panelVisible = false
    if (ballVisible) {
      await ball.click().catch(() => {})
      await page.waitForTimeout(800)
      panelVisible = await page.locator('.ai-panel').isVisible().catch(() => false)
      await page.screenshot({ path: join(SHOTS, 'ai-panel.png') }).catch(() => {})
    }
    report.interactions.ai = { ballVisible, panelVisible }
  } catch (e) {
    report.interactions.error = failText(e)
  }

  // 记录本页日志
  report.pageLogs = logs

  // 移动端
  try {
    const m = await makePage(browser, { width: 390, height: 844 }, BLOCK)
    for (const [path, name] of [['/', 'm-home'], ['/guides', 'm-guides'], ['/destinations', 'm-destinations'], ['/holidays', 'm-holidays']]) {
      try {
        const info = await visit(m.page, path, { wait: 1800, shotName: name })
        report.mobile.push({ path, ...info, logs: { console: m.logs.console.length, pageErrors: m.logs.pageErrors.length, requestFailed: m.logs.requestFailed.length } })
        console.log(`  [mobile] ${path} HTTP ${info.status} overflow=${info.horizontalOverflow}`)
      } catch (e) {
        report.mobile.push({ path, error: failText(e) })
        console.log(`  [mobile] ${path} ERROR ${failText(e)}`)
      }
    }
    // 移动端截图落到专门目录：visit 默认写 SHOTS，这里补一张到 MOBILE
    await m.page.screenshot({ path: join(MOBILE, 'final.png') }).catch(() => {})
    await m.ctx.close()
  } catch (e) {
    report.mobile.push({ error: failText(e) })
  }

  // 公网抽查（只读，可选）
  if (PUBLIC_BASE) {
    try {
      const pub = await makePage(browser, { width: 1440, height: 900 }, false)
      const resp = await pub.page.goto(PUBLIC_BASE.replace(/\/$/, '') + '/', { waitUntil: 'domcontentloaded' })
      await pub.page.waitForTimeout(3000)
      report.publicSite = await pub.page.evaluate(() => ({
        title: document.title,
        url: location.href,
        footer: (document.querySelector('.app-footer')?.innerText || '').slice(0, 500),
        guides: document.querySelectorAll('.guide-card').length
      }))
      report.publicSite.status = resp ? resp.status() : null
      await pub.page.screenshot({ path: join(SHOTS, 'public-home.png') }).catch(() => {})
      await pub.ctx.close()
      console.log(`[public] ${report.publicSite.status} ${report.publicSite.title}`)
    } catch (e) {
      report.publicSite = { error: failText(e) }
      console.log(`[public] ERROR ${failText(e)}`)
    }
  }

  report.images = [...imageCache.values()]
  report.stats = summarizeImages(report.images)
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`[images] ${JSON.stringify(report.stats)}`)
  console.log(`[logs] console=${logs.console.length} pageErrors=${logs.pageErrors.length} requestFailed=${logs.requestFailed.length} badResponses=${logs.badResponses.length}`)
  console.log(`[audit] report=${join(OUT, 'report.json')}`)

  await ctx.close()
  await browser.close()

  const fatal = report.pages.some(p => p.error || (p.status && p.status >= 500))
  process.exitCode = fatal ? 1 : 0
}

main().catch(e => { console.error('[audit] fatal:', e); process.exit(1) })
