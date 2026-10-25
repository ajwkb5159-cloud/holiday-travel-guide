// E2E 验证脚本（Playwright + 系统 Edge，零浏览器下载）
// 覆盖：逐页截图（桌面 9 页 + 移动 3 页）、收藏双向 toast、筛选/搜索/分页交互、
//       断图兜底、深链刷新、API 404 语义
// 用法：node scripts/e2e-verify.mjs [--base http://127.0.0.1:5199] [--shots <dir>]
// 截图后需用视觉模型 MCP 逐张审查布局（见全局 CLAUDE.md WT-2）
import { mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// playwright-core 装在 web 子项目；显式解析避免 scripts/ 目录无 node_modules
const require = createRequire(import.meta.url)
const { chromium } = require(join(ROOT, 'holiday-travel-guide-web', 'node_modules', 'playwright-core'))
const args = process.argv.slice(2)
const argVal = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const BASE = argVal('--base', 'http://127.0.0.1:5199')
const SHOTS = resolve(ROOT, argVal('--shots', '.test-env/shots'))
mkdirSync(SHOTS, { recursive: true })

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

const DESKTOP_PAGES = [
  { path: '/', name: 'home' },
  { path: '/guides', name: 'guides-list' },
  { path: '/destinations', name: 'destinations' },
  { path: '/holidays', name: 'holidays' },
  { path: '/tags', name: 'tags' },
  { path: '/favorites', name: 'favorites' },
  { path: '/search?q=北京', name: 'search' }
]
const MOBILE_PAGES = [
  { path: '/', name: 'm-home' },
  { path: '/guides', name: 'm-guides-list' }
]

async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage })
  console.log(`    📸 ${name}.png`)
}

// 外链图片（picsum/loremflickr）会让 networkidle 永远等不到；改 domcontentloaded + 渲染等待
async function goto(page, path) {
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  return resp
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)

  console.log(`[e2e] base=${BASE} shots=${SHOTS}`)

  // ---------- 1. 逐页访问 + 截图（桌面） ----------
  console.log('\n[1] 桌面逐页访问')
  for (const p of DESKTOP_PAGES) {
    try {
      const resp = await goto(page, p.path)
      record(`访问 ${p.path}`, resp && resp.status() === 200, `HTTP ${resp && resp.status()}`)
      await shot(page, p.name)
    } catch (e) {
      record(`访问 ${p.path}`, false, String(e.message).slice(0, 100))
    }
  }

  // 动态页面：攻略详情 / 目的地详情
  try {
    const guideId = await page.evaluate(async () => {
      const r = await fetch('/api/guide?page=1&size=1').then(x => x.json())
      return r.Data.Items[0].Id
    })
    const resp = await goto(page, `/guides/${guideId}`)
    record('访问 /guides/{id} 详情', resp && resp.status() === 200, `id=${guideId}`)
    await shot(page, 'guide-detail')
  } catch (e) {
    record('访问 /guides/{id} 详情', false, String(e.message).slice(0, 100))
  }
  try {
    const destResp = await goto(page, `/destinations/${encodeURIComponent('北京')}`)
    record('访问 /destinations/北京', destResp && destResp.status() === 200, `HTTP ${destResp && destResp.status()}`)
    await shot(page, 'destination-detail')
  } catch (e) {
    record('访问 /destinations/北京', false, String(e.message).slice(0, 100))
  }

  // ---------- 2. 收藏双向 toast ----------
  console.log('\n[2] 收藏交互（卡片）')
  try {
    await goto(page, '/guides')
    await page.evaluate(() => localStorage.removeItem('holiday-guide-favorites'))
    await page.reload({ waitUntil: 'networkidle' })
    const card = page.locator('.guide-card').first()
    const favBtn = card.locator('.fav-btn')
    const iconBefore = (await favBtn.innerText()).trim()

    await favBtn.click()
    await page.waitForSelector('.el-message', { timeout: 3000 })
    const msg1 = (await page.locator('.el-message').last().innerText()).trim()
    const iconAfter = (await favBtn.innerText()).trim()
    record('未收藏→点击：toast=已加入收藏', msg1.includes('已加入收藏'), `msg="${msg1}"`)
    record('未收藏→点击：图标变 ❤️', iconBefore === '🤍' && iconAfter === '❤️', `${iconBefore}→${iconAfter}`)
    await shot(page, 'fav-card-added', false)

    await page.waitForTimeout(1500) // 等第一条 toast 消失
    await favBtn.click()
    await page.waitForSelector('.el-message', { timeout: 3000 })
    const msg2 = (await page.locator('.el-message').last().innerText()).trim()
    const iconFinal = (await favBtn.innerText()).trim()
    record('已收藏→点击：toast=已取消收藏', msg2.includes('已取消收藏'), `msg="${msg2}"`)
    record('已收藏→点击：图标变 🤍', iconFinal === '🤍', `${iconAfter}→${iconFinal}`)
    await shot(page, 'fav-card-removed', false)
  } catch (e) {
    record('收藏卡片交互', false, String(e.message).slice(0, 100))
  }

  console.log('\n[3] 收藏交互（详情页）')
  try {
    await page.evaluate(() => localStorage.removeItem('holiday-guide-favorites'))
    const guideId = await page.evaluate(async () => {
      const r = await fetch('/api/guide?page=1&size=1').then(x => x.json())
      return r.Data.Items[0].Id
    })
    await goto(page, `/guides/${guideId}`)
    const favDetail = page.locator('.fav-detail')
    await favDetail.click()
    await page.waitForSelector('.el-message', { timeout: 3000 })
    const msg1 = (await page.locator('.el-message').last().innerText()).trim()
    record('详情未收藏→点击：toast=已加入收藏', msg1.includes('已加入收藏'), `msg="${msg1}"`)
    await page.waitForTimeout(1500)
    await favDetail.click()
    await page.waitForSelector('.el-message', { timeout: 3000 })
    const msg2 = (await page.locator('.el-message').last().innerText()).trim()
    record('详情已收藏→点击：toast=已取消收藏', msg2.includes('已取消收藏'), `msg="${msg2}"`)
  } catch (e) {
    record('收藏详情页交互', false, String(e.message).slice(0, 100))
  }

  // ---------- 4. 筛选 / 搜索 / 分页 ----------
  console.log('\n[4] 筛选与搜索')
  try {
    await goto(page, '/guides')
    const selects = page.locator('.filter-bar .el-select')
    await selects.nth(0).click()  // [0]=季节 [1]=目的地
    const opt = page.locator('.el-select-dropdown__item:visible').filter({ hasText: '夏季' }).first()
    await opt.waitFor({ timeout: 5000 })
    await opt.click()
    await page.waitForTimeout(800)
    const url = page.url()
    record('攻略页季节筛选', url.includes('season=summer'), `url=${url}`)
    await shot(page, 'guides-season-filtered')

    // 分页：翻页是组件内状态（page 不写 URL），断言第一张卡片内容变化
    const next = page.locator('.el-pagination .btn-next')
    if (await next.isEnabled().catch(() => false)) {
      const firstTitleBefore = (await page.locator('.guide-card .card-title').first().innerText()).trim()
      await next.click()
      await page.waitForTimeout(1200)
      const firstTitleAfter = (await page.locator('.guide-card .card-title').first().innerText()).trim()
      record('分页翻页（内容变化）', firstTitleBefore !== firstTitleAfter, `${firstTitleBefore} → ${firstTitleAfter}`)
    } else {
      record('分页翻页', true, '只有一页，跳过')
    }
  } catch (e) {
    record('筛选/分页交互', false, String(e.message).slice(0, 100))
  }
  try {
    await goto(page, '/destinations')
    const destSelect = page.locator('.filter-bar .el-select').first()
    await destSelect.click()
    const opt = page.locator('.el-select-dropdown__item').filter({ hasText: '浙江' }).first()
    await opt.click()
    await page.waitForTimeout(800)
    const cards = await page.locator('.dest-card').count()
    record('目的地按地区筛选', cards > 0 && cards <= 3, `结果卡片数=${cards}`)
    await shot(page, 'destinations-filtered')
  } catch (e) {
    record('目的地筛选交互', false, String(e.message).slice(0, 100))
  }
  try {
    await goto(page, '/')
    const input = page.locator('.header-search input')
    await input.fill('北京')
    await input.press('Enter')
    await page.waitForTimeout(800)
    record('头部搜索跳转', page.url().includes('/search'), `url=${page.url()}`)
    await shot(page, 'search-result')
  } catch (e) {
    record('头部搜索交互', false, String(e.message).slice(0, 100))
  }

  // ---------- 5. 深链刷新 + API 404 ----------
  console.log('\n[5] 深链与 API 语义')
  try {
    const resp = await goto(page, '/guides')
    record('深链 /guides 直开', resp && resp.status() === 200, `HTTP ${resp && resp.status()}`)
    const api404 = await page.evaluate(async () => {
      const r = await fetch('/api/nonexistent-xyz')
      return r.status
    })
    record('未知 /api/xxx 保持 404', api404 === 404, `HTTP ${api404}`)
  } catch (e) {
    record('深链/API 语义', false, String(e.message).slice(0, 100))
  }

  // ---------- 6. 断图兜底 ----------
  console.log('\n[6] 断图兜底专项')
  try {
    await ctx.route(/picsum\.photos|loremflickr\.com/, route => route.abort())
    await goto(page, '/guides')
    await shot(page, 'nofig-guides')
    await goto(page, '/destinations')
    await shot(page, 'nofig-destinations')
    await goto(page, '/guides/1')
    await shot(page, 'nofig-detail')
    record('断图截图完成（需视觉模型审查兜底可读性）', true, 'nofig-guides/destinations/detail')
    await ctx.unroute(/picsum\.photos|loremflickr\.com/)
  } catch (e) {
    record('断图兜底', false, String(e.message).slice(0, 100))
  }

  // ---------- 7. 移动宽度 ----------
  console.log('\n[7] 移动 390×844')
  await page.setViewportSize({ width: 390, height: 844 })
  for (const p of MOBILE_PAGES) {
    try {
      const resp = await goto(page, p.path)
      record(`移动访问 ${p.path}`, resp && resp.status() === 200, `HTTP ${resp && resp.status()}`)
      await shot(page, p.name, true)
    } catch (e) {
      record(`移动访问 ${p.path}`, false, String(e.message).slice(0, 100))
    }
  }
  try {
    const guideId = await page.evaluate(async () => {
      const r = await fetch('/api/guide?page=1&size=1').then(x => x.json())
      return r.Data.Items[0].Id
    })
    await goto(page, `/guides/${guideId}`)
    record('移动访问详情', true)
    await shot(page, 'm-guide-detail', true)
  } catch (e) {
    record('移动访问详情', false, String(e.message).slice(0, 100))
  }

  await browser.close()

  const failed = results.filter(r => !r.ok)
  console.log(`\n[e2e] 共 ${results.length} 项断言，${results.length - failed.length} 过 / ${failed.length} 挂`)
  if (failed.length) {
    console.log('失败项：')
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error('[e2e] 致命错误:', e)
  process.exit(1)
})
