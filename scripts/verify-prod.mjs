// 生产站点最终抽查（5099）
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(join(ROOT, 'holiday-travel-guide-web', 'node_modules', 'playwright-core'))
const BASE = process.argv[2] || 'http://127.0.0.1:5099'
const SHOTS = join(ROOT, '.test-env', 'shots-prod')
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)
const results = []
const rec = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? '  ✓' : '  ✗'} ${n}${d ? ' — ' + d : ''}`) }
const goto = async (p) => { const r = await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1800); return r }

let r = await goto('/'); rec('首页', r.status() === 200)
const nearest = await page.evaluate(() => [...document.querySelectorAll('.section-title')].some(e => (e.textContent || '').includes('临近节日')))
rec('首页「临近节日攻略」区', nearest)
await page.screenshot({ path: join(SHOTS, 'home.png') })

r = await goto('/guides'); rec('攻略列表', r.status() === 200)
const cards = await page.locator('.guide-card').count()
rec('列表卡片数>0', cards > 0, `cards=${cards}`)

const id = await page.evaluate(async () => (await fetch('/api/guide?page=1&size=1').then(x => x.json())).Data.Items[0].Id)
r = await goto(`/guides/${id}`); rec('攻略详情深链', r.status() === 200)
await page.screenshot({ path: join(SHOTS, 'detail.png') })

r = await goto('/search?q=' + encodeURIComponent('北京')); rec('搜索直开', r.status() === 200)
const hl = await page.locator('em.hl').count()
rec('搜索高亮', hl > 0, `hl=${hl}`)
await page.screenshot({ path: join(SHOTS, 'search.png') })

await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200)
const after = await page.locator('.guide-card').count()
rec('刷新搜索复现', after > 0, `cards=${after}`)

r = await goto('/destinations/' + encodeURIComponent('北京')); rec('目的地详情深链', r.status() === 200)
r = await goto('/favorites'); rec('收藏页', r.status() === 200)
r = await goto('/holidays'); rec('节假日页', r.status() === 200)

const jsErr = []
page.on('pageerror', e => jsErr.push(e.message))
rec('无 JS 报错', jsErr.length === 0, jsErr.join('; ') || 'clean')

await browser.close()
const failed = results.filter(x => !x).length
console.log(`\n[prod-check] ${results.length} 项，${results.length - failed} 过 / ${failed} 挂`)
process.exitCode = failed ? 1 : 0
