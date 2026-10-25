// Task#6 XHTML 冒烟：用 playwright-core + 系统edge，访问测试端口，截桌面+移动首页/列表/详情/搜索，
// 并探测详情页 v-html 是否经 DOMPurify 清洗（无 <script>）。截屏留存供视觉复核。
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// playwright-core 装在 web 子项目 node_modules
const require = createRequire(path.join(__dirname, '../holiday-travel-guide-web', 'package.json'))
const { chromium } = require('playwright-core')

const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1] || 'http://127.0.0.1:5199'
const SHOT = path.join(__dirname, '..', '.test-env', 'shots-task6')
import fs from 'fs'
fs.mkdirSync(SHOT, { recursive: true })

const pages = [
  { name: 'home', url: '/' },
  { name: 'guides', url: '/guides' },
  { name: 'guide-detail', url: '/guides/333' },
  { name: 'search', url: '/search?q=' + encodeURIComponent('北京') },
  { name: 'holidays', url: '/holidays' },
  { name: 'favorites', url: '/favorites' }
]

const results = []
const record = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' :: ' + info : '')) }

const browser = await chromium.launch({ channel: 'msedge', headless: true })

// 桌面 1440×900
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const dp = await desktop.newPage()
// 外链图片慢：拦截占位图，加速并测兜底
await dp.route(/loremflickr\.com|picsum\.photos/, r => r.abort())

// 先取一个真实攻略 id（兜底因 333 可能不存在）
let detailId = 333
try {
  const apiRes = await dp.request.get(BASE + '/api/guide?page=1&size=1')
  const j = await apiRes.json()
  if (j?.Data?.Items?.length) detailId = j.Data.Items[0].Id
} catch (e) {}
pages[2].url = '/guides/' + detailId

for (const p of pages) {
  try {
    await dp.goto(BASE + p.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await dp.waitForTimeout(1500)
    await dp.screenshot({ path: path.join(SHOT, 'd-' + p.name + '.png'), fullPage: false })
    record('desktop ' + p.name, true)
  } catch (e) { record('desktop ' + p.name, false, String(e).slice(0, 120)) }
}

// XSS 探测：详情页 DOM 不应含 script 标签
try {
  await dp.goto(BASE + '/guides/' + detailId, { waitUntil: 'domcontentloaded' })
  await dp.waitForTimeout(2000)
  const scriptCount = await dp.evaluate(() => document.querySelectorAll('.detail-content script').length)
  record('XSS-no-script-in-content', scriptCount === 0, 'script count=' + scriptCount)
} catch (e) { record('XSS-no-script-in-content', false, String(e).slice(0, 120)) }

// 移动 390×844：首页/列表/详情
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
const mp = await mobile.newPage()
await mp.route(/loremflickr\.com|picsum\.photos/, r => r.abort())
for (const p of ['home', 'guides', 'guide-detail']) {
  try {
    const url = p === 'guide-detail' ? '/guides/' + detailId : p === 'home' ? '/' : '/guides'
    await mp.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await mp.waitForTimeout(1500)
    await mp.screenshot({ path: path.join(SHOT, 'm-' + p + '.png') })
    record('mobile ' + p, true)
  } catch (e) { record('mobile ' + p, false, String(e).slice(0, 120)) }
}

// NearestGuides 区块是否存在（首页）
try {
  await dp.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await dp.waitForTimeout(2000)
  const hasNearest = await dp.evaluate(() => {
    const titles = [...document.querySelectorAll('.section-title, [class*="title"]')].map(e => e.textContent || '')
    return titles.some(t => t.includes('临近节日'))
  })
  record('home-nearest-section', hasNearest, hasNearest ? '找到区块' : '未找到区块')
} catch (e) { record('home-nearest-section', false, String(e).slice(0, 120)) }

await browser.close()
const failed = results.filter(r => !r.ok).length
console.log('\n=== 汇总 ' + (results.length - failed) + '/' + results.length + ' passed ===')
if (failed > 0) { console.log('失败项:', results.filter(r => !r.ok).map(r => r.name)); process.exitCode = 1 }