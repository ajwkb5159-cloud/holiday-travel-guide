// 升级功能验证：数据新鲜度页脚 + 忙时遮罩（503 友好提示）+ 恢复自动刷新
// 用法：node scripts/verify-upgrade.mjs --base http://127.0.0.1:5201 --token <test-token> --month 202601
//       （token 也可用 UPDATE_TOKEN 环境变量或 --config <appsettings.json> 提供）
// 安全：默认拒绝对 5099 生产端口运行；确需运行请显式加 --allow-prod
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(join(ROOT, 'holiday-travel-guide-web', 'node_modules', 'playwright-core'))
const args = process.argv.slice(2)
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const BASE = argVal('--base', 'http://127.0.0.1:5199')
const MONTH = argVal('--month', '202601')
const CONFIG = argVal('--config', '')
let TOKEN = argVal('--token', process.env.UPDATE_TOKEN || '')
if (!TOKEN && CONFIG) {
  try { TOKEN = JSON.parse(readFileSync(CONFIG, 'utf-8')).Update?.Token || '' } catch { /* fall through */ }
}
if (!TOKEN) {
  console.error('[verify-upgrade] 缺少 Update Token：请用 --token / UPDATE_TOKEN / --config <appsettings.json> 提供')
  process.exit(2)
}
if (/:5099(\/|$)/.test(BASE) && !args.includes('--allow-prod')) {
  console.error('[verify-upgrade] 拒绝对 5099 生产端口执行 begin/abort；测试请用隔离端口，或显式加 --allow-prod')
  process.exit(2)
}
const SHOTS = join(ROOT, '.test-env', 'shots-upgrade')
mkdirSync(SHOTS, { recursive: true })

let activeJob = null
const results = []
const record = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`) }

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts)
  const body = await r.text()
  return { status: r.status, body }
}

async function beginSession() {
  const r = await api('/api/update/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Update-Token': TOKEN },
    body: JSON.stringify({ monthKey: MONTH })
  })
  const j = JSON.parse(r.body)
  const id = j.Data && (j.Data.jobId || j.Data.JobId)
  if (id) activeJob = id
  return id
}

async function abortSession(jobId) {
  await api('/api/update/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Update-Token': TOKEN },
    body: JSON.stringify({ jobId })
  })
  if (activeJob === jobId) activeJob = null
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name + '.png') })
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  console.log('[verify-upgrade] base=' + BASE)

  try {
  // ---------- 1. 正常态：页脚数据新鲜度 ----------
  console.log('\n[1] 页脚数据新鲜度')
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const footerText = await page.locator('.app-footer').innerText()
  const hasPublish = /攻略数据更新于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · 共 \d+ 篇/.test(footerText)
  record('页脚显示「攻略数据更新于 … 共 N 篇」', hasPublish, footerText.replace(/\n/g, ' | '))
  await shot(page, '1-footer-freshness')

  // ---------- 2. 更新窗口：遮罩出现 ----------
  console.log('\n[2] 更新窗口遮罩')
  const jobId = await beginSession()
  record('begin 会话成功', !!jobId, 'jobId=' + jobId)
  const r503 = await api('/api/guide/home')
  record('更新中读接口 503 友好提示', r503.status === 503 && r503.body.includes('服务器繁忙，请稍后重试'), 'HTTP ' + r503.status + ' ' + r503.body)

  await page.goto(BASE + '/guides', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const overlayVisible = await page.locator('.maintenance-overlay').isVisible().catch(() => false)
  record('页面加载时遮罩出现', overlayVisible, '')
  if (overlayVisible) {
    const title = await page.locator('.busy-title').innerText()
    const sub = await page.locator('.busy-sub').innerText()
    const hasBtn = await page.locator('.busy-card .el-button').isVisible()
    record('遮罩文案「服务器繁忙，请稍后重试」', title.includes('服务器繁忙，请稍后重试') && sub.includes('更新攻略数据'), title + ' / ' + sub)
    record('遮罩含立即重试按钮', hasBtn, '')
    await shot(page, '2-busy-overlay')
    const countText = await page.locator('.busy-count').innerText()
    record('遮罩含自动重试倒计时', /自动重试倒计时 \d+ 秒/.test(countText), countText)
  } else {
    record('遮罩出现', false, 'overlay not visible')
  }

  // ---------- 3. 恢复：遮罩消失 + 自动刷新 ----------
  console.log('\n[3] 恢复自动刷新')
  await abortSession(jobId)
  await page.waitForTimeout(9000)
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(2500)
  const overlayGone = !(await page.locator('.maintenance-overlay').isVisible().catch(() => false))
  record('遮罩消失', overlayGone, '')
  const cardCount = await page.locator('.guide-card').count()
  record('页面刷新后内容恢复（攻略卡 > 0）', cardCount > 0, 'cards=' + cardCount)
  const rNormal = await api('/api/guide/home')
  record('读接口恢复 200', rNormal.status === 200, 'HTTP ' + rNormal.status)
  await shot(page, '3-recovered')

  // ---------- 4. 移动端遮罩 ----------
  console.log('\n[4] 移动端')
  const mCtx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const mPage = await mCtx.newPage()
  mPage.setDefaultTimeout(20000)
  const mJob = await beginSession()
  await mPage.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await mPage.waitForTimeout(3500)
  const mOverlay = await mPage.locator('.maintenance-overlay').isVisible().catch(() => false)
  record('移动端遮罩出现', mOverlay, '')
  if (mOverlay) await shot(mPage, '4-busy-overlay-mobile')
  await abortSession(mJob)
  await mPage.waitForTimeout(9000)
  await mPage.waitForLoadState('domcontentloaded').catch(() => {})
  await mPage.waitForTimeout(2000)
  const mGone = !(await mPage.locator('.maintenance-overlay').isVisible().catch(() => false))
  record('移动端遮罩消失并恢复', mGone, '')
  await mCtx.close()

  // ---------- 5. /api/system/status 公开可用 ----------
  console.log('\n[5] 公开状态接口')
  const st = await api('/api/system/status')
  const stj = JSON.parse(st.body)
  record('/api/system/status 无鉴权可达', st.status === 200 && stj.Code === 0, 'Mode=' + stj.Data.Mode + ' LastMonth=' + stj.Data.LastMonthKey + ' Guides=' + stj.Data.GuideCount)

  } finally {
    if (activeJob) {
      try { await abortSession(activeJob) } catch { /* best effort */ }
    }
    await browser.close().catch(() => {})
  }
  const fails = results.filter(r => !r.ok)
  console.log('\n[verify-upgrade] 共 ' + results.length + ' 项，' + (results.length - fails.length) + ' 过 / ' + fails.length + ' 挂')
  process.exit(fails.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
