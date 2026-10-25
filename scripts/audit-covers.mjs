// 封面唯一性审计：全量攻略的 coverImage 是否 120 篇 120 张、每城 10 张、全部可加载。
// 用法：node scripts/audit-covers.mjs --base http://127.0.0.1:5201
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
const OUT = join(ROOT, '.test-env')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

const items = await page.evaluate(async (base) => {
  const all = []
  let pageNo = 1
  while (true) {
    const r = await fetch(`${base}/api/guide?page=${pageNo}&size=50`).then(x => x.json())
    const d = r.Data || {}
    const rows = d.Items || []
    all.push(...rows.map(g => ({ id: g.Id, dest: g.Destination, cover: g.CoverImage })))
    if (all.length >= (d.Total || 0) || rows.length === 0 || pageNo >= 10) break
    pageNo++
  }
  return all
}, BASE)

const unique = [...new Set(items.map(x => x.cover))]
const perDest = {}
for (const x of items) {
  perDest[x.dest] = perDest[x.dest] || new Set()
  perDest[x.dest].add(x.cover)
}
const perDestCounts = Object.fromEntries(Object.entries(perDest).map(([k, v]) => [k, v.size]))

const probe = await page.evaluate(async (urls) => {
  const out = []
  let cursor = 0
  async function load(url) {
    const t0 = performance.now()
    return await new Promise(resolve => {
      const img = new Image()
      let done = false
      const timer = setTimeout(() => { if (!done) { done = true; img.src = ''; resolve({ url, ok: false, ms: Math.round(performance.now() - t0), error: 'timeout' }) } }, 10000)
      img.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve({ url, ok: true, ms: Math.round(performance.now() - t0), w: img.naturalWidth, h: img.naturalHeight }) } }
      img.onerror = () => { if (!done) { done = true; clearTimeout(timer); resolve({ url, ok: false, ms: Math.round(performance.now() - t0), error: 'error' }) } }
      img.src = url
    })
  }
  async function worker() { while (cursor < urls.length) out.push(await load(urls[cursor++])) }
  await Promise.all(Array.from({ length: Math.min(8, urls.length) }, worker))
  return out
}, unique)

const ok = probe.filter(x => x.ok)
const failed = probe.filter(x => !x.ok)
const p = (arr, q) => arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil(q / 100 * arr.length) - 1)] : null
const report = {
  base: BASE,
  totalGuides: items.length,
  uniqueCovers: unique.length,
  perDestination: perDestCounts,
  allDestinationsTen: Object.values(perDestCounts).every(n => n === 10),
  allCoversLocal: unique.every(u => typeof u === 'string' && u.startsWith('/images/destinations/')),
  probe: {
    total: probe.length,
    ok: ok.length,
    failed: failed.length,
    p50ms: p(ok.map(x => x.ms), 50),
    p95ms: p(ok.map(x => x.ms), 95),
    failedUrls: failed.slice(0, 20)
  }
}
writeFileSync(join(OUT, 'cover-audit.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
const pass = report.totalGuides === 120 && report.uniqueCovers === 120 && report.allDestinationsTen && report.allCoversLocal && failed.length === 0
console.log(pass ? 'COVER_AUDIT_PASS' : 'COVER_AUDIT_FAIL')
process.exit(pass ? 0 : 1)
