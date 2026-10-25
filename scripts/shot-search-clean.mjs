// 干净搜索截图 v2：用 Escape 关闭建议下拉，不点页面
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(join(ROOT, 'holiday-travel-guide-web', 'node_modules', 'playwright-core'))
const BASE = process.argv[2] || 'http://127.0.0.1:5199'
const OUT = join(ROOT, '.test-env', 'shots-v2', 'search-clean.png')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)
await page.goto(`${BASE}/search?q=${encodeURIComponent('北京')}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
// 若下拉开着则按 Escape 关闭
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
const st = await page.evaluate(() => ({
  url: location.pathname + location.search,
  hl: document.querySelectorAll('em.hl').length,
  dd: !!document.querySelector('.el-autocomplete-suggestion__wrap')
}))
console.log('state:', JSON.stringify(st))
await page.screenshot({ path: OUT })
await browser.close()
console.log('saved', OUT)
