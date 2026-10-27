// AI 行程助手 + 个性化推荐 升级验证（PLAN.md 第四节）
// 自包含测试栈：复制后端发布产物到 .test-env/ai-run（纯 ASCII 相对路径），生产库快照，
// 全新端口（探测 5199 起顺延），分阶段切换 Ai 配置（开启/坏上游/关闭）并重启实例。
// 用法：node scripts/verify-ai.mjs --source-db <snapshot.db> [--bin <backend dir>] [--port-start 5219]
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { startMockAi } from './lib/mock-ai-upstream.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(join(ROOT, 'holiday-travel-guide-web', 'node_modules', 'playwright-core'))
const args = process.argv.slice(2)
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }

const BIN = argVal('--bin', join(ROOT, 'HolidayGuideBackend', 'bin', 'Debug', 'net10.0'))
const PROD_DB = argVal('--source-db', '')
if (!PROD_DB) {
  console.error('[verify-ai] --source-db <path-to-holiday.db> is required (use a copied snapshot, not the live production file)')
  process.exit(2)
}
const PORT_START = Number(argVal('--port-start', '5199'))

// ---------- AI provider 参数（默认 OpenCode Go） ----------
const EXPLICIT_KEY_FILE = argVal('--key-file', process.env.AI_TEST_KEY_FILE || '')
const EXPLICIT_BASE = argVal('--base-url', process.env.AI_TEST_BASE_URL || '')
const EXPLICIT_MODEL = argVal('--model', process.env.AI_TEST_MODEL || '')
const API_KEY = argVal('--api-key', process.env.AI_TEST_API_KEY || '')
const DEFAULT_OPENCODE_KEY = 'F:\\HolidayGuide\\secrets\\opencode.key'
const KEY_FILE = EXPLICIT_KEY_FILE || DEFAULT_OPENCODE_KEY
let INLINE_KEY = API_KEY
if (!INLINE_KEY && /\.json$/i.test(KEY_FILE)) {
  try {
    const doc = JSON.parse(readFileSync(KEY_FILE, 'utf-8'))
    INLINE_KEY = String(doc?.['opencode-go']?.key || '').trim()
  } catch { /* fall through */ }
}
const GOOD_UPSTREAM = EXPLICIT_BASE || 'https://opencode.ai/zen/go/v1/chat/completions'
const AI_MODEL = EXPLICIT_MODEL || 'deepseek-v4.1-flash'
const MAX_TOKENS = Number(argVal('--max-tokens', process.env.AI_TEST_MAX_TOKENS || '3000'))
const SEND_REASONING = args.includes('--send-reasoning') || process.env.AI_TEST_SEND_REASONING === '1'
const MOCK_ONLY = args.includes('--mock-only')
const HAS_REAL_KEY = !!INLINE_KEY || existsSync(KEY_FILE)
if (!HAS_REAL_KEY && !MOCK_ONLY) {
  console.error(`[verify-ai] 未找到真实 key：${KEY_FILE}。可用 --key-file/--api-key，或 --mock-only 只跑 mock 解析器测试`)
  process.exit(2)
}
if (!MOCK_ONLY) {
  console.log(`[verify-ai] provider=${GOOD_UPSTREAM} model=${AI_MODEL} key=${INLINE_KEY ? '(inline)' : KEY_FILE} sendReasoning=${SEND_REASONING}`)
}

const RUN = join(ROOT, '.test-env', 'ai-run')
const SHOTS = join(ROOT, '.test-env', 'shots-ai')
if (!Number.isInteger(PORT_START) || PORT_START === 5099 || PORT_START < 1024) {
  console.error('[verify-ai] invalid --port-start; 5099 is production and is refused')
  process.exit(2)
}
if (!RUN.includes('.test-env')) {
  console.error('[verify-ai] test run dir must live under .test-env')
  process.exit(2)
}

// ---------- 端口探测（PORT_START 起顺延，跳过 5099） ----------
async function probePort(start = PORT_START) {
  for (let p = start; p < start + 20; p++) {
    if (p === 5099) continue
    const free = await new Promise(resolve => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      srv.listen(p, '127.0.0.1')
    })
    if (free) return p
  }
  throw new Error('no free port')
}

// ---------- 结果登记 ----------
const results = []
let failed = false
function record(n, ok, d = '') {
  results.push({ n, ok, d })
  if (!ok) failed = true
  console.log(`${ok ? '  ✓' : '  ✗'} ${n}${d ? ' — ' + d : ''}`)
}

const log = (m) => { console.log(m); appendFileSync(join(RUN, 'verify.log'), m + '\n') }

// ---------- 测试栈管理 ----------
let proc = null
const PORT = await probePort(PORT_START)
const BASE = `http://127.0.0.1:${PORT}`

function makeAppsettings({ enabled, baseUrl, dailyIpQuota, globalCap, apiKey = '', maxTokens = MAX_TOKENS, sendReasoning = SEND_REASONING }) {
  const isMock = /127\.0\.0\.1|localhost/.test(baseUrl)
  const effectiveKey = apiKey || (isMock ? 'mock-key' : INLINE_KEY)
  const effectiveKeyFile = effectiveKey ? '' : KEY_FILE
  return JSON.stringify({
    Logging: { LogLevel: { Default: 'Warning' } },
    AllowedHosts: '*',
    ConnectionStrings: { SQLite: 'Data/holiday.db' },
    Update: { Token: 'test-token-only', BusyDuringUpdate: true, BusyWhenEmpty: true },
    Ai: {
      Enabled: enabled,
      BaseURL: baseUrl,
      ApiKey: effectiveKey,
      ApiKeyFile: effectiveKeyFile,
      Model: AI_MODEL,
      MaxTokens: maxTokens,
      Temperature: 0.7,
      TimeoutSeconds: 180,
      SendReasoningContent: sendReasoning,
      QuotaEnabled: false,
      HistoryMaxTurns: 500,
      HistoryMaxChars: 1500000,
      HistoryPerMessageChars: 50000,
      ExtraBodyJson: '',
      DailyIpQuota: dailyIpQuota,
      GlobalDailyCap: globalCap,
      RetrieveTopK: 6,
      MaxConcurrent: 3
    },
    Kestrel: { Endpoints: { Http: { Url: `http://127.0.0.1:${PORT}` } } }
  }, null, 2)
}

const BAD_UPSTREAM = 'http://127.0.0.1:9/v1/chat/completions' // discard 端口，连接必败

function stopServer() {
  if (!proc) return Promise.resolve()
  const pid = proc.pid
  try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }) } catch { /* 已退出 */ }
  proc = null
  // 只等自己启动的 PID，避免生产上的同名进程让这里白等
  const waitGone = async () => {
    for (let i = 0; i < 25; i++) {
      try {
        execSync(`tasklist /FI "PID eq ${pid}" | findstr /I "${pid}"`, { stdio: 'ignore' })
        await sleep(300)
      } catch { return }
    }
  }
  return waitGone()
}

async function startServer(cfg) {
  await stopServer()
  writeFileSync(join(RUN, 'appsettings.json'), makeAppsettings(cfg))
  const logFile = join(RUN, 'server.log')
  proc = spawn(join(RUN, 'HolidayGuideBackend.exe'), [], { cwd: RUN, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', d => appendFileSync(logFile, d))
  proc.stderr.on('data', d => appendFileSync(logFile, d))
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return
    } catch { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 400))
  }
  throw new Error(`server not ready in 32s，见 ${join(RUN, 'server.log')}`)
}

// ---------- HTTP 工具 ----------
async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, opts)
  let body = null
  try { body = await r.json() } catch { /* 非 JSON */ }
  return { status: r.status, body, headers: r.headers }
}
const utf8Body = (obj) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify(obj), 'utf8') })

/** 消费一次 AI 对话直到终态，返回 {events:[{event,data}], finalStatus} */
async function aiChat(question, ip, history = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (ip) headers['X-Forwarded-For'] = ip
  const payload = { Question: question }
  if (history) payload.History = history
  const r = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST', headers,
    body: Buffer.from(JSON.stringify(payload), 'utf8')
  })
  if (r.status !== 200) {
    const body = await r.json().catch(() => null)
    return { status: r.status, body, events: [] }
  }
  const events = []
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  outer: while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2)
      let evt = 'message'; const datas = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evt = line.slice(6).trim()
        else if (line.startsWith('data:')) datas.push(line.slice(5).trim())
      }
      if (!datas.length) continue
      let data; try { data = JSON.parse(datas.join('\n')) } catch { continue }
      events.push({ event: evt, data })
      if (evt === 'error') break outer
    }
  }
  return { status: 200, events }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function runMockPhases() {
  console.log('\n[M1] mock SSE 解析器（空 choices + reasoning + delta）')
  const mock = await startMockAi({ mode: 'sse' })
  try {
    await startServer({ enabled: true, baseUrl: mock.baseUrl, dailyIpQuota: 5, globalCap: 20 })
    const r = await aiChat('mock 测试', '10.0.0.1')
    record('mock SSE 返回 delta', r.status === 200 && r.events.some(e => e.event === 'delta'), `events=${r.events.map(e => e.event).join(',')}`)
    record('mock SSE 不因空 choices 崩溃', !r.events.some(e => e.event === 'error'))
    record('mock SSE 正常 done', r.events.some(e => e.event === 'done'))
    if (SEND_REASONING) record('mock SSE reasoning 事件', r.events.some(e => e.event === 'reasoning'))
  } finally {
    await mock.close()
  }

  console.log('\n[M2] mock JSON 回退（非 SSE 200）')
  const mockJson = await startMockAi({ mode: 'json' })
  try {
    await startServer({ enabled: true, baseUrl: mockJson.baseUrl, dailyIpQuota: 5, globalCap: 20 })
    const r = await aiChat('mock json 测试', '10.0.0.2')
    record('非 SSE 200 回退为 delta', r.status === 200 && r.events.some(e => e.event === 'delta'), `events=${r.events.map(e => e.event).join(',')}`)
    record('JSON 回退正常 done', r.events.some(e => e.event === 'done'))
  } finally {
    await mockJson.close()
  }
  stopServer()
}

function summarize() {
  const pass = results.filter(r => r.ok).length
  console.log(`\n========== verify-ai 汇总：${pass}/${results.length} 通过 ==========`)
  if (failed) {
    console.log('失败项：')
    results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.n} — ${r.d}`))
    process.exit(1)
  }
}

// ================= 主流程 =================
async function main() {
  console.log(`[verify-ai] port=${PORT}`)
  rmSync(RUN, { recursive: true, force: true })
  mkdirSync(join(RUN, 'Data'), { recursive: true })
  mkdirSync(SHOTS, { recursive: true })

  // 复制构建产物 + 快照库
  cpSync(BIN, RUN, { recursive: true })
  // bin/Debug 里的 wwwroot 可能是旧副本；测试栈必须用刚 build 出来的最新前端
  const latestWwwroot = join(ROOT, 'HolidayGuideBackend', 'wwwroot')
  if (existsSync(latestWwwroot)) cpSync(latestWwwroot, join(RUN, 'wwwroot'), { recursive: true })
  if (!existsSync(join(RUN, 'HolidayGuideBackend.exe'))) throw new Error('build output missing, run dotnet build first')
  if (!existsSync(PROD_DB)) throw new Error('prod db snapshot missing')
  cpSync(PROD_DB, join(RUN, 'Data', 'holiday.db'))

  if (MOCK_ONLY) {
    await runMockPhases()
    summarize()
    return
  }

  // ---------- 阶段1：AI 开启（无每日额度限制） ----------
  await startServer({ enabled: true, baseUrl: GOOD_UPSTREAM, dailyIpQuota: 2, globalCap: 5 })

  console.log('\n[1] 推荐 API（/api/guide/recommend）')
  {
    const empty = await api('/api/guide/recommend')
    record('空参数返回热门榜语义', empty.status === 200 && empty.body.Code === 0 && empty.body.Data.length === 8, `n=${empty.body.Data && empty.body.Data.length}`)

    const bj = await api('/api/guide/recommend?destinations=' + encodeURIComponent('北京') + '&limit=6')
    const allBj = bj.body.Data.every(g => g.Destination === '北京')
    record('目的地亲和命中', bj.status === 200 && bj.body.Data.length === 6 && allBj, `allBeijing=${allBj}`)

    const ex = await api('/api/guide/recommend?destinations=' + encodeURIComponent('北京') + '&limit=8&excludeIds=' + bj.body.Data.map(g => g.Id).join(','))
    const noOverlap = ex.body.Data.every(g => !bj.body.Data.some(x => x.Id === g.Id))
    record('excludeIds 生效', ex.status === 200 && ex.body.Data.length > 0 && noOverlap, `overlap=${!noOverlap}`)

    const tags = await api('/api/guide/recommend?tags=' + encodeURIComponent('美食,亲子') + '&limit=8')
    record('标签亲和返回正常', tags.status === 200 && tags.body.Data.length > 0, `n=${tags.body.Data.length}`)

    const det = await api('/api/guide/recommend?destinations=' + encodeURIComponent('北京') + '&limit=6')
    const ids1 = det.body.Data.map(g => g.Id).join(',')
    const det2 = await api('/api/guide/recommend?destinations=' + encodeURIComponent('北京') + '&limit=6')
    record('同日结果稳定（缓存/确定性）', ids1 === det2.body.Data.map(g => g.Id).join(','))
  }

  console.log('\n[2] AI 状态与额度接口')
  {
    const st = await api('/api/ai/status')
    record('/api/ai/status enabled=true', st.body.Data.Enabled === true)

    const q1 = await api('/api/ai/quota', { headers: { 'X-Forwarded-For': '6.6.6.1' } })
    record('quota 无每日限制', q1.body.Data.Unlimited === true && q1.body.Data.Limit === -1 && q1.body.Data.Remaining === -1, JSON.stringify(q1.body.Data))

    const q2 = await api('/api/ai/quota')
    record('quota 无 XFF 也返回 Unlimited', q2.body.Data.Unlimited === true, JSON.stringify(q2.body.Data))
  }

  // ---------- 阶段2：浏览器 UI ----------
  console.log('\n[3] AI 悬浮窗 UI（真实 LLM 流式）')
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(25000)
  const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false })

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(1800)
  const ballVisible = await page.locator('.ai-ball').isVisible().catch(() => false)
  record('AI 关闭前悬浮球可见', ballVisible)
  await shot('01-home-ball')

  // 打开面板 → 欢迎语
  await page.locator('.ai-ball').click()
  await sleep(900)
  const panelVisible = await page.locator('.ai-panel').isVisible()
  record('点球开面板', panelVisible)
  const greet = await page.locator('.msg-bubble').first().innerText().catch(() => '')
  record('欢迎语气泡', greet.includes('行程助手'), greet.slice(0, 24))
  await shot('02-panel-open')

  // 真实对话（127.0.0.1 独立 scope，额度 2）：命中站内词库的问题
  await page.locator('.panel-input input').fill('国庆节去北京玩3天怎么安排？')
  await page.locator('.send-btn').click()

  // 流式断言：气泡文本持续增长
  let grew = false
  let lenPrev = -1
  for (let i = 0; i < 90; i++) {
    await sleep(500)
    const len = await page.evaluate(() => {
      const rows = document.querySelectorAll('.msg-row.row-ai .msg-text')
      return rows.length ? rows[rows.length - 1].textContent.length : 0
    }).catch(() => 0)
    if (len > lenPrev + 4) grew = true
    lenPrev = len
    const done = await page.evaluate(() => !document.querySelector('.typing-cursor')).catch(() => false)
    if (done && i > 4) break
  }
  record('流式增量到达（打字机增长）', grew && lenPrev > 50, `len=${lenPrev}`)
  const answerText = await page.evaluate(() => {
    const rows = document.querySelectorAll('.msg-row.row-ai .msg-text')
    return rows.length ? rows[rows.length - 1].textContent : ''
  })
  record('回答含北京行程内容', /北京|故宫|长城|天安门/.test(answerText), answerText.slice(0, 30))
  await shot('03-streaming-done')

  // sources 引用卡片渲染 + 点击跳详情
  const chipCount = await page.locator('.source-chip').count()
  record('sources 引用卡片渲染', chipCount >= 1, `chips=${chipCount}`)
  if (chipCount > 0) {
    await page.locator('.source-chip').first().click()
    await sleep(1500)
    const onDetail = /\/guides\/\d+/.test(page.url())
    record('点引用卡跳攻略详情', onDetail, page.url())
    await shot('04-jump-detail')
  }

  // 回到首页再开面板：无限额度下不显示剩余次数
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(1200)
  await page.locator('.ai-ball').click()
  await sleep(800)
  const foot = await page.locator('.panel-foot').innerText().catch(() => '')
  record('不显示额度角标', !/剩余/.test(foot) && !/\/2/.test(foot), foot.trim().slice(0, 26))
  await shot('05-no-quota-badge')
  await page.keyboard.press('Escape')
  await page.locator('.head-close').click()

  console.log('\n[4] 猜你喜欢（localStorage 行为信号）')
  {
    // 注入行为：浏览过北京攻略 + 收藏上海一篇
    await page.evaluate(() => {
      localStorage.setItem('holiday-guide-behavior', JSON.stringify([
        { id: 333, destination: '北京', category: '', tags: ['人文'], season: 'autumn', ts: Date.now() },
        { id: 321, destination: '北京', category: '', tags: ['美食'], season: 'summer', ts: Date.now() - 3600e3 }
      ]))
      localStorage.setItem('holiday-guide-favorites', JSON.stringify([{ id: 357, addedAt: 1 }]))
    })
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await sleep(2000)
    const hasSection = await page.evaluate(() => {
      return [...document.querySelectorAll('.section-title')].some(e => e.textContent.includes('猜你喜欢'))
    })
    record('有行为数据时「猜你喜欢」渲染', hasSection)
    const cards = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('.section')]
      const sec = sections.find(s => s.querySelector('.section-title') && s.querySelector('.section-title').textContent.includes('猜你喜欢'))
      return sec ? sec.querySelectorAll('.guide-card').length : 0
    })
    record('推荐模块卡片数=6', cards === 6, `cards=${cards}`)
    const bjRatio = await page.evaluate(async () => {
      const r = await fetch('/api/guide/recommend?destinations=' + encodeURIComponent('北京') + '&limit=6').then(x => x.json())
      return r.Data.filter(g => g.Destination === '北京').length
    })
    record('推荐命中兴趣目的地', bjRatio >= 4, `beijing=${bjRatio}/6`)
    await shot('06-recommend-section')

    // 清空行为 → 模块隐藏
    await page.evaluate(() => localStorage.clear())
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await sleep(1500)
    const gone = await page.evaluate(() =>
      ![...document.querySelectorAll('.section-title')].some(e => e.textContent.includes('猜你喜欢')))
    record('清空行为后模块隐藏', gone)
    await shot('07-recommend-hidden')
  }
  await browser.close()

  // ---------- 阶段3：无限对话（同 IP 连续多问不 429） ----------
  console.log('\n[5] 无限对话（QuotaEnabled=false）')
  {
    for (let i = 1; i <= 3; i++) {
      const r = await aiChat(`测试问题${i}`, '7.7.7.1')
      record(`同 IP 第 ${i} 问成功（无 429）`, r.status === 200 && r.events.some(e => e.event === 'delta'), `status=${r.status}`)
    }
    const q = await api('/api/ai/quota', { headers: { 'X-Forwarded-For': '7.7.7.1' } })
    record('连续问答后仍 Unlimited', q.body.Data.Unlimited === true, JSON.stringify(q.body.Data))
  }

  // ---------- 阶段3b：多轮对话（验证 reasoning_content 历史兼容） ----------
  console.log('\n[5b] 多轮对话（reasoning 历史兼容）')
  {
    await startServer({ enabled: true, baseUrl: GOOD_UPSTREAM, dailyIpQuota: 4, globalCap: 50 })
    const history = [
      { Role: 'user', Content: '北京有什么必去的景点？' },
      { Role: 'assistant', Content: '故宫、长城、颐和园。' }
    ]
    if (SEND_REASONING) history[1].ReasoningContent = '用户问北京景点，需要列举三个代表景点。'
    const mt = await aiChat('再推荐一个适合亲子的', '7.7.7.9', history)
    record('多轮对话返回 delta', mt.status === 200 && mt.events.some(e => e.event === 'delta'), `status=${mt.status} events=${mt.events.map(e => e.event).join(',')}`)
    record('多轮对话无 error', !mt.events.some(e => e.event === 'error'), mt.events.find(e => e.event === 'error')?.data?.Message || '')
  }

  // ---------- 阶段4：坏上游 → error 事件 ----------
  console.log('\n[6] 上游故障')
  {
    await startServer({ enabled: true, baseUrl: BAD_UPSTREAM, dailyIpQuota: 2, globalCap: 50 })
    const bad = await aiChat('你好', '9.9.9.9')
    const gotError = bad.events.some(e => e.event === 'error')
    record('坏上游收到 SSE error 事件', gotError || bad.status !== 200, `status=${bad.status} events=${bad.events.map(e => e.event).join(',')}`)
    const q = await api('/api/ai/quota', { headers: { 'X-Forwarded-For': '9.9.9.9' } })
    record('坏上游后额度仍 Unlimited', q.body.Data.Unlimited === true, JSON.stringify(q.body.Data))
  }

  // ---------- 阶段5：AI 关闭 → 501 + 悬浮球隐藏 ----------
  console.log('\n[7] AI 关闭模式')
  {
    await startServer({ enabled: false, baseUrl: GOOD_UPSTREAM, dailyIpQuota: 2, globalCap: 5 })
    const st = await api('/api/ai/status')
    record('status enabled=false', st.body.Data.Enabled === false)
    const chat = await api('/api/ai/chat', utf8Body({ Question: 'hi' }))
    record('chat 返回 501', chat.status === 501, `status=${chat.status}`)

    const b2 = await chromium.launch({ channel: 'msedge', headless: true })
    const p2 = await b2.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage())
    await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await sleep(1800)
    const hidden = !(await p2.locator('.ai-ball').isVisible().catch(() => false))
    record('关闭模式下悬浮球不渲染', hidden)
    await p2.screenshot({ path: join(SHOTS, '08-disabled-no-ball.png') })
    await b2.close()
  }

  stopServer()
  summarize()
}

main().catch(e => {
  console.error('[verify-ai] FATAL:', e.message)
  stopServer()
  process.exit(1)
})
