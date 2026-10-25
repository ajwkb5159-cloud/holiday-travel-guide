// D 段精细诊断:模拟前序交互后,逐步打印排序点击的中间状态
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(join(ROOT, 'holiday-travel-guide-web', 'node_modules', 'playwright-core'))
const BASE = process.argv[2] || 'http://127.0.0.1:5199'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(20000)

// 模拟全量脚本 D 段前:进 guides 再清 localStorage(空文档不能访问 localStorage)
await page.goto(`${BASE}/guides`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.goto(`${BASE}/guides`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const titleBefore = (await page.locator('.guide-card .card-title').first().innerText()).trim()
console.log('titleBefore:', titleBefore)
console.log('urlBefore:', page.url())

const step = (n, v) => console.log(`  [${n}]`, v)

// 步1: 看 .sort-select 存在否、可见否
const ss = page.locator('.sort-select').first()
step('1 sort-select count', await page.locator('.sort-select').count())
step('1 sort-select visible', await ss.isVisible().catch(() => 'err'))

// 步2: 点击
try {
  await ss.click({ timeout: 5000 })
  step('2 click', 'ok')
} catch (e) {
  step('2 click', 'FAIL ' + e.message.slice(0, 100))
}
await page.waitForTimeout(600)

// 步3: 看弹层项总数 + 可见数 + 文本
const allItems = await page.locator('.el-select-dropdown__item').allInnerTexts()
step('3 dropdown items(all)', JSON.stringify(allItems))
const visItems = await page.locator('.el-select-dropdown__item:visible').allInnerTexts().catch(() => 'catch')
step('3 dropdown items(:visible)', JSON.stringify(visItems))

// 步4: 定位「最新发布」选项(latest 匹配,不 first/last 偏见)
const latestOpt = page.locator('.el-select-dropdown__item').filter({ hasText: '最新发布' })
step('4 latest count', await latestOpt.count())
for (let i = 0; i < await latestOpt.count(); i++) {
  const v = await latestOpt.nth(i).isVisible().catch(() => 'err')
  step(`4 latest[${i}] visible`, v)
}

// 步5: 点可见的那一个
try {
  // 找第一个 visible 的
  let clicked = false
  for (let i = 0; i < await latestOpt.count(); i++) {
    if (await latestOpt.nth(i).isVisible().catch(() => false)) {
      await latestOpt.nth(i).click({ timeout: 5000 })
      step(`5 click latest[${i}]`, 'ok')
      clicked = true
      break
    }
  }
  if (!clicked) step('5 click', 'NO VISIBLE latest option')
} catch (e) {
  step('5 click', 'FAIL ' + e.message.slice(0, 120))
}
await page.waitForTimeout(1800)

// 步6: 结果
step('6 urlAfter', page.url())
const titleAfter = (await page.locator('.guide-card .card-title').first().innerText()).trim()
step('6 titleAfter', titleAfter)
step('6 sort in url?', /sort=latest/.test(page.url()))

await browser.close()