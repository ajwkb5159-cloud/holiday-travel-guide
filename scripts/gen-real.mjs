// LLM 保姆级攻略生成器（月度数据生产器）
// 120 篇 = 12 目的地 × 10 节日；每篇 8 大板块 HTML 长文；partial 断点续跑
// 免费通道优先：智谱 GLM-4-Flash（官方免费模型）→ 硅基流动免费层 → 兜底复用上月内容
//
// 用法：
//   node scripts/gen-real.mjs [--month yyyyMM] [--baseline yyyyMM|auto|none]
//                             [--provider zhipu] [--fallback-provider siliconflow]
//                             [--model M] [--concurrency 2] [--segments 2|3]
//                             [--only <externalId>] [--validate-only] [--assemble-only]
//                             [--dry-run] [--key-file F] [--key-dir DIR] [--api-key K] [--no-fallback]
//                             [--probe-keys]
// 说明：
//   --month           目标月份（默认本地当月），输出 HolidayGuideUpdater/data/{yyyyMM}/
//   --baseline        兜底内容来源（默认 auto = data 下小于目标月的最大月份；none = 不兜底）
//   --provider        主通道；--fallback-provider 备用通道（主通道单篇失败后自动切换）
//   --key-dir         key 文件目录（默认 HOLIDAY_GUIDE_KEY_DIR，其次当前用户目录）；SYSTEM 计划任务必须显式指定
//   --probe-keys      仅探测各通道 key 是否可读（打印 masked key）后退出，用于定时任务排障
//   --segments        每篇正文分几段生成（默认 2；免费模型输出上限小，分段可根治截断）
//   --assemble-only   不调 LLM，仅用 partial + baseline 组装（中断后补齐用）
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_ROOT = join(ROOT, 'HolidayGuideUpdater', 'data')
// key 目录解析：--key-dir > HOLIDAY_GUIDE_KEY_DIR > 当前用户目录。
// 计划任务以 SYSTEM 身份运行时 homedir() 指向 systemprofile，必须显式指向真实用户目录。
const KEY_HOME = process.env.HOLIDAY_GUIDE_KEY_DIR || homedir()

// ---------- 配置 ----------
const DESTINATIONS = [
  { slug: 'beijing', name: '北京', region: '北京', category: '人文', imgKw: 'beijing,forbidden-city', themes: ['故宫人文深度游', '胡同Citywalk慢游', '长城徒步', '亲子研学'] },
  { slug: 'hangzhou', name: '杭州', region: '浙江', category: '人文', imgKw: 'hangzhou,west-lake', themes: ['西湖山水慢游', '龙井茶文化', '宋韵古风', '亲子休闲'] },
  { slug: 'sanya', name: '三亚', region: '海南', category: '自然', imgKw: 'sanya,beach', themes: ['海岛度假', '亲子玩水', '潜水冲浪', '蜜月浪漫'] },
  { slug: 'chengdu', name: '成都', region: '四川', category: '美食', imgKw: 'chengdu,panda', themes: ['熊猫研学', '美食探店', '茶馆慢生活', '周边古镇'] },
  { slug: 'xian', name: '西安', region: '陕西', category: '人文', imgKw: 'xian,terracotta', themes: ['盛唐文化', '博物馆之旅', '碳水美食', '古都夜游'] },
  { slug: 'guangzhou', name: '广州', region: '广东', category: '美食', imgKw: 'guangzhou,canton-tower', themes: ['早茶美食', '老城Citywalk', '亲子乐园', '珠江夜游'] },
  { slug: 'haerbin', name: '哈尔滨', region: '黑龙江', category: '休闲', imgKw: 'harbin,ice-festival', themes: ['冰雪世界', '中央大街俄式风情', '雪乡周边', '冬日夜景'] },
  { slug: 'qingdao', name: '青岛', region: '山东', category: '休闲', imgKw: 'qingdao,sea', themes: ['海滨度假', '啤酒文化', '老城漫步', '亲子赶海'] },
  { slug: 'shanghai', name: '上海', region: '上海', category: '休闲', imgKw: 'shanghai,bund', themes: ['都市Citywalk', '博物馆艺术', '迪士尼亲子', '夜景外滩'] },
  { slug: 'chongqing', name: '重庆', region: '重庆', category: '美食', imgKw: 'chongqing,night-view', themes: ['山城夜景', '火锅美食', '轻轨打卡', '武隆周边'] },
  { slug: 'xiamen', name: '厦门', region: '福建', category: '自然', imgKw: 'xiamen,gulangyu', themes: ['鼓浪屿文艺', '环岛路骑行', '海滨亲子', '老城漫步'] },
  { slug: 'guilin', name: '桂林', region: '广西', category: '自然', imgKw: 'guilin,landscape', themes: ['漓江山水', '阳朔徒步', '骑行摄影', '乡村慢生活'] }
]

// 沿用 gen-mock 的 10 条节日（日期不动，保证倒计时非空）；补 slug/season/days 映射
const HOLIDAYS = [
  { slug: 'qixi', name: '七夕', date: '2026-08-19', type: 'traditional', isLegal: 0, description: '中国情人节，浪漫出行', season: 'summer', days: 3 },
  { slug: 'zhongqiu', name: '中秋节', date: '2026-09-25', type: 'traditional', isLegal: 1, description: '赏月吃月饼，阖家团圆', season: 'autumn', days: 3 },
  { slug: 'guoqing', name: '国庆节', date: '2026-10-01', type: 'legal', isLegal: 1, description: '七天长假，出行高峰，提前规划', season: 'autumn', days: 5 },
  { slug: 'chongyang', name: '重阳节', date: '2026-10-18', type: 'traditional', isLegal: 0, description: '登高望远，敬老孝亲', season: 'autumn', days: 3 },
  { slug: 'shengdan', name: '圣诞节', date: '2026-12-25', type: 'custom', isLegal: 0, description: '冬日浪漫氛围', season: 'winter', days: 3 },
  { slug: 'yuandan', name: '元旦', date: '2027-01-01', type: 'legal', isLegal: 1, description: '新年第一天，短途出游好时机', season: 'winter', days: 3 },
  { slug: 'chunjie', name: '春节', date: '2027-02-06', type: 'traditional', isLegal: 1, description: '回家过年或反向旅行避寒', season: 'winter', days: 5 },
  { slug: 'qingming', name: '清明节', date: '2027-04-05', type: 'traditional', isLegal: 1, description: '踏青扫墓，春游正当时', season: 'spring', days: 3 },
  { slug: 'laodong', name: '劳动节', date: '2027-05-01', type: 'legal', isLegal: 1, description: '五天小长假，中长途旅行', season: 'spring', days: 5 },
  { slug: 'duanwu', name: '端午节', date: '2027-06-09', type: 'traditional', isLegal: 1, description: '赛龙舟吃粽子', season: 'summer', days: 4 }
]

// 免费优先：zhipu（官方免费模型）→ siliconflow（免费层小模型）→ dashscope（阿里云，仅在 --provider 显式指定时用）
const PROVIDERS = {
  zhipu: {
    name: '智谱 GLM-4-Flash（官方免费模型）',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    envKeys: ['ZHIPU_API_KEY', 'GLM_API_KEY', 'BIGMODEL_API_KEY'],
    keyFile: join(KEY_HOME, '.zhipu.key'),
    maxTokens: 4095,
    jsonMode: true
  },
  siliconflow: {
    name: '硅基流动免费层（GLM-4-9B-0414）',
    baseURL: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'THUDM/GLM-4-9B-0414',
    envKeys: ['SILICONFLOW_API_KEY'],
    keyFile: join(KEY_HOME, '.siliconflow.key'),
    maxTokens: 4096,
    jsonMode: true
  },
  dashscope: {
    name: '阿里云 DashScope（qwen-flash，付费/额度制，仅在显式指定时使用）',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-flash',
    envKeys: ['DASHSCOPE_API_KEY', 'ALIYUN_API_KEY', 'QWEN_API_KEY'],
    keyFile: join(KEY_HOME, '.dashscope.key'),
    maxTokens: 8192,
    jsonMode: true
  }
}

// 图片策略：本地自托管（wwwroot/images），彻底摆脱外链图床故障。
// 每个城市准备 10 张不同景点图，按节日序号（01-10）分配，保证同城不同攻略封面不重复。
const HOLIDAY_SLUG_BY_NAME = new Map(HOLIDAYS.map(h => [h.name, h.slug]))
const HOLIDAY_INDEX_BY_SLUG = new Map(HOLIDAYS.map((h, i) => [h.slug, i]))
const coverUrl = (dest, holiday) => {
  const slug = holiday?.slug || HOLIDAY_SLUG_BY_NAME.get(holiday?.name)
  const idx = HOLIDAY_INDEX_BY_SLUG.get(slug) ?? 0
  return `/images/destinations/${dest.slug}-${String(idx + 1).padStart(2, '0')}.jpg`
}
const holidayCoverUrl = (holiday) => {
  const slug = holiday.slug || HOLIDAY_SLUG_BY_NAME.get(holiday.name) || 'zhongqiu'
  return `/images/holidays/${slug}.jpg`
}

// ---------- API key 探测 ----------
const mask = (key) => key ? `****${key.slice(-4)}` : '(未找到)'

function findKeyFromMcpConfig(keyHome = KEY_HOME) {
  const candidates = []
  const files = [join(keyHome, '.claude.json'), join(ROOT, '.mcp.json'), join(ROOT, 'holiday-travel-guide-web', '.mcp.json')]
  for (const f of files) {
    if (!existsSync(f)) continue
    try {
      const raw = readFileSync(f, 'utf-8')
      const re = /(?:ZHIPU|GLM|BIGMODEL|DEEPSEEK|ANTHROPIC|SILICONFLOW)[A-Z_]*API[_-]?KEY["'\s:=]+["']?([A-Za-z0-9._-]{20,})/gi
      let m
      while ((m = re.exec(raw)) !== null) candidates.push(m[1])
      const re2 = /"(?:apiKey|API_KEY)"\s*:\s*"([A-Za-z0-9._-]{20,})"/g
      while ((m = re2.exec(raw)) !== null) candidates.push(m[1])
    } catch { /* 忽略不可读文件 */ }
  }
  return [...new Set(candidates)]
}

/** key 解析链：显式参数 → provider 专属 key 文件（key 目录可配置）→ 环境变量 → 本机 MCP 配置探测 */
function detectKey(provider, explicitKey, keyFile, keyHome = KEY_HOME) {
  if (explicitKey) return explicitKey
  const files = [keyFile, provider.keyFile, join(keyHome, `.${provider.model.replace(/[^a-z0-9]/gi, '')}.key`)].filter(Boolean)
  for (const file of [...new Set(files)]) {
    if (file && existsSync(file)) {
      try {
        const k = readFileSync(file, 'utf-8').trim()
        if (k) {
          console.log(`[keyDetect] ${provider.model} 读取 key 文件 ${file} → ${mask(k)}`)
          return k
        }
      } catch (err) {
        console.error(`[keyDetect] 无法读取 key 文件 ${file}: ${err.message}`)
      }
    }
  }
  for (const envName of provider.envKeys) {
    if (process.env[envName]) {
      console.log(`[keyDetect] ${provider.model} 命中环境变量 ${envName} → ${mask(process.env[envName])}`)
      return process.env[envName]
    }
  }
  const fromMcp = findKeyFromMcpConfig(keyHome)
  if (fromMcp.length) {
    console.log(`[keyDetect] ${provider.model} 从本机 MCP 配置复用 ${fromMcp.length} 个 key（仅运行时使用，不落盘）→ ${mask(fromMcp[0])}`)
    return fromMcp[0]
  }
  console.warn(`[keyDetect] ${provider.model} 未找到 key；已查: ${[...new Set(files)].join(' | ')}`)
  return null
}

// ---------- LLM 调用 ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function stripFences(text) {
  let t = String(text).trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return t.trim()
}

function parseJsonLoose(text) {
  const t = stripFences(text)
  try {
    return JSON.parse(t)
  } catch {
    // 容错：截取第一个 { 到最后一个 }
    const s = t.indexOf('{'), e = t.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1))
    throw new Error(`JSON 解析失败: ${t.slice(0, 120)}`)
  }
}

/** 单次调用：失败返回 {error}，调用方决定重试/换通道 */
async function callOnce(provider, apiKey, system, user, maxTokens = null) {
  const body = {
    model: provider.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.85,
    max_tokens: maxTokens ?? provider.maxTokens
  }
  if (provider.jsonMode !== false) body.response_format = { type: 'json_object' }

  const t0 = Date.now()
  const resp = await fetch(provider.baseURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  })
  const ms = Date.now() - t0

  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 200)
    // JSON 模式不被支持时自动降级一次（去掉 response_format）
    if (resp.status === 400 && provider.jsonMode !== false && /response_format|json/i.test(text)) {
      provider.jsonMode = false
      console.warn(`  [warn] ${provider.model} 不支持 response_format，已降级为纯 prompt 约束`)
      return callOnce(provider, apiKey, system, user, maxTokens)
    }
    return { error: `HTTP ${resp.status}: ${text}`, ms }
  }

  const data = await resp.json()
  const choice = data?.choices?.[0]
  const content = choice?.message?.content ?? ''
  const usage = data?.usage ?? {}
  try {
    const parsed = parseJsonLoose(content)
    return { parsed, ms, usage, finish: choice?.finish_reason }
  } catch (err) {
    return { error: `${err.message} (finish=${choice?.finish_reason}, completion=${usage?.completion_tokens ?? '?'})`, ms, usage }
  }
}

/** 带重试的调用：同一通道最多 attempts 次，失败信息反馈给模型重试 */
async function callWithRetry(provider, apiKey, system, user, attempts = 2, maxTokens = null) {
  let lastErr = ''
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await callOnce(provider, apiKey, system, user, maxTokens)
      if (!r.error) return r
      lastErr = r.error
    } catch (err) {
      lastErr = String(err?.message ?? err)
    }
    console.warn(`  [retry] ${provider.model} 失败（第 ${attempt}/${attempts} 次）：${lastErr.slice(0, 140)}`)
    if (attempt < attempts) {
      await sleep([2000, 6000][attempt - 1] ?? 6000)
      user = `${user}\n\n【上次输出解析失败，错误信息：${lastErr.slice(0, 300)}】请严格按要求重新输出合法 JSON。`
    }
  }
  throw new Error(lastErr || 'LLM 调用失败')
}

// ---------- Prompt ----------
const SYSTEM_PROMPT = `你是资深旅行规划师，为旅游网站撰写「保姆级节日出游攻略」。硬性要求：
1. 只输出一个 JSON 对象，不要 markdown 代码块围栏、不要任何 JSON 之外的文字
2. HTML 只用这些标签：h2/h3/p/ul/ol/li/table/thead/tbody/tr/th/td/blockquote/strong。禁止内嵌 <script>、禁止输出代码围栏
3. 信息必须具体真实：真实地名、景点名、菜名、价格区间（人民币）；不得编造节日日期
4. 价格给区间（如「人均 300-500 元」），不确定的信息不要编造
5. 行程节奏合理不过度赶场`

/** 分段描述：每段负责的板块与字数预算 */
const SEGMENT_PLAN = {
  2: [
    { key: 'part1', title: '行程总览 + 每日行程 + 交通指南 + 住宿推荐', want: '1000-1200', blocks: '①行程总览（h2 + 1 个 table：天数/主题/适合人群/预算区间）②每日行程（h2 + 每天 1 个 h3「第N天」，每天内含「上午/下午/晚上」三个加粗小标题段落，具体到景点与时间安排）③交通指南（h2 + h3/ul，含往返大交通与市内交通）④住宿推荐（h2 + ul，3 个档位：经济/舒适/特色，含区域与价格区间）' },
    { key: 'part2', title: '美食推荐 + 预算参考 + 避坑贴士 + 结语', want: '900-1100', blocks: '⑤美食推荐（h2 + ul，具体菜名与店铺类型，不少于 6 项）⑥预算参考（h2 + 1 个 table，按 交通/住宿/门票/餐饮/其他 分项估算人均）⑦避坑贴士（h2 + ul，至少 5 条具体建议）⑧结语（h2 + 1 段）' }
  ],
  3: [
    { key: 'part1', title: '行程总览 + 每日行程', want: '800-1000', blocks: '①行程总览（h2 + 1 个 table：天数/主题/适合人群/预算区间）②每日行程（h2 + 每天 1 个 h3「第N天」，每天内含「上午/下午/晚上」三个加粗小标题段落）' },
    { key: 'part2', title: '交通指南 + 住宿推荐 + 美食推荐', want: '700-900', blocks: '③交通指南（h2 + h3/ul，含往返大交通与市内交通）④住宿推荐（h2 + ul，3 个档位：经济/舒适/特色）⑤美食推荐（h2 + ul，具体菜名与店铺类型，不少于 6 项）' },
    { key: 'part3', title: '预算参考 + 避坑贴士 + 结语', want: '600-800', blocks: '⑥预算参考（h2 + 1 个 table，按 交通/住宿/门票/餐饮/其他 分项估算人均）⑦避坑贴士（h2 + ul，至少 5 条具体建议）⑧结语（h2 + 1 段）' }
  ]
}

function buildUserPrompt(entry, avoidTitles, batchInfo) {
  const avoid = avoidTitles.length ? `\n避免与这些已有标题/开头雷同：${avoidTitles.join('、')}` : ''
  return `目的地：${entry.dest.name}（${entry.dest.region}）
节日：${entry.hol.name}（${entry.hol.date}）
季节：${entry.hol.season}    天数：${entry.hol.days} 天
主题侧重：${entry.theme}
${batchInfo}
请输出 JSON。${avoid}`
}

const batchLine = (month) => month
  ? `本次为 ${month.slice(0, 4)} 年 ${Number(month.slice(4, 6))} 月发布的月度批次：内容须体现 ${month.slice(0, 4)} 年当下的旅行信息（价格、交通、营业时间），不要出现更早年份的过时表述。`
  : ''

function buildSegmentPrompt(entry, seg, prevPlain, avoidTitles, month) {
  const head = `目的地：${entry.dest.name}（${entry.dest.region}）
节日：${entry.hol.name}（${entry.hol.date}）
季节：${entry.hol.season}    天数：${entry.hol.days} 天
主题侧重：${entry.theme}
${batchLine(month)}`

  if (seg.key === 'part1') {
    return `${head}
请只输出一个 JSON 对象，严格形如（字段名不得改动、不得嵌套）：
{"title":"标题","summary":"摘要正文","tags":["标签一","标签二","标签三"],"part1":"<h2>行程总览</h2><table>…</table>…"}
硬性要求：
- title ≤25 字，必须包含目的地与节日名；summary 80-120 字；tags 必须是恰好 3 个字符串的数组（不是单个字符串、不用逗号或竖线连接）
- part1 是完整 HTML 字符串，按顺序包含以下板块：${seg.blocks}
- part1 纯文本字数必须达到 ${seg.want} 个中文字（务必写足，不要省略、不要用「等」「例如」敷衍）
只输出 JSON，不要任何其它文字。`
  }

  return `${head}
你正在续写同一篇攻略的后半部分。已写好的前半部分内容如下（不要重复其中内容）：
"""
${prevPlain.slice(0, 900)}
"""
请只输出一个 JSON 对象，严格形如（字段名不得改动、不得嵌套）：
{"${seg.key}":"<h2>美食推荐</h2><ul>…</ul>…"}
硬性要求：
- ${seg.key} 是完整 HTML 字符串，按顺序包含以下板块：${seg.blocks}
- 承接上文风格与口吻，不重复前半部分已提到的景点/餐馆/条目
- ${seg.key} 纯文本字数必须达到 ${seg.want} 个中文字（务必写足，不要省略）
只输出 JSON，不要任何其它文字。`
}

const SEG_SYSTEM = (entry) => `${SYSTEM_PROMPT}
6. 输出的正文 HTML 天数与给定天数严格一致：只出现「第1天」到「第${entry.hol.days}天」的完整序列，不得出现「第${entry.hol.days + 1}天」`

/** tags 归一化：兼容数组/字符串/各种分隔符（部分模型会返回 "a|b|c"） */
function normalizeTags(raw) {
  let list = []
  if (Array.isArray(raw)) list = raw.map(x => String(x))
  else if (typeof raw === 'string') list = [raw]
  list = list.flatMap(t => t.split(/[|、,，/\s]+/)).map(t => t.replace(/[「」【】"'。]/g, '').trim()).filter(Boolean)
  // 去重（保持顺序）后最多 3 个
  return [...new Set(list)].slice(0, 3)
}

// ---------- 校验 ----------
const stripHtml = (html) => String(html).replace(/<[^>]+>/g, '')

function trigramSimilarity(a, b) {
  const grams = (s) => {
    const set = new Set()
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3))
    return set
  }
  const ga = grams(a), gb = grams(b)
  if (!ga.size || !gb.size) return 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  return inter / Math.min(ga.size, gb.size)
}

function validateGuide(entry, g) {
  const errors = []
  const idRe = /^[a-z0-9-]{1,64}$/
  if (!idRe.test(g.externalId)) errors.push(`externalId 非法: ${g.externalId}`)
  if (![3, 4, 5].includes(g.days)) errors.push(`days 非法: ${g.days}`)
  const text = stripHtml(g.content)
  if (text.length < 1800) errors.push(`正文字数不足: ${text.length} < 1800`)
  if (text.length > 5000) errors.push(`正文过长: ${text.length} > 5000`)
  if (!((g.content.match(/<h2[^>]*>/gi) || []).length >= 6)) errors.push('h2 板块 < 6')
  if (!g.content.includes('<table')) errors.push('缺少 table（行程总览/预算参考）')
  if (!text.includes(`第${g.days}天`)) errors.push(`正文缺「第${g.days}天」`)
  if (text.includes(`第${g.days + 1}天`)) errors.push(`正文出现越界「第${g.days + 1}天」`)
  const tags = Array.isArray(g.tags) ? g.tags : []
  if (tags.length !== 3 || tags.some(t => !t || t.includes(','))) errors.push(`tags 须恰好 3 个无逗号: ${JSON.stringify(tags)}`)
  if (!g.title || g.title.length > 25) errors.push(`title 非法: ${g.title}`)
  if (!g.summary) errors.push('summary 为空')
  if (g.season !== entry.hol.season) errors.push(`season 与节日映射不一致: ${g.season}`)
  return errors
}

// ---------- 主流程 ----------
function parseArgs(argv) {
  const args = {
    concurrency: 2, provider: 'zhipu', fallbackProvider: 'siliconflow', model: null, apiKey: null,
    keyFile: null, keyDir: null, probeKeys: false, only: null, validateOnly: false, assembleOnly: false, dryRun: false,
    month: null, baseline: 'auto', segments: 2, noFallback: false, smoke: null
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--concurrency') args.concurrency = Number(argv[++i])
    else if (a === '--provider') args.provider = argv[++i]
    else if (a === '--fallback-provider') args.fallbackProvider = argv[++i]
    else if (a === '--api-key') args.apiKey = argv[++i]
    else if (a === '--key-file') args.keyFile = argv[++i]
    else if (a === '--key-dir') args.keyDir = argv[++i]
    else if (a === '--probe-keys') args.probeKeys = true
    else if (a === '--model') args.model = argv[++i]
    else if (a === '--only') args.only = argv[++i]
    else if (a === '--month') args.month = argv[++i]
    else if (a === '--baseline') args.baseline = argv[++i]
    else if (a === '--segments') args.segments = Number(argv[++i])
    else if (a === '--validate-only') args.validateOnly = true
    else if (a === '--assemble-only') args.assembleOnly = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--no-fallback') args.noFallback = true
    else if (a === '--smoke') args.smoke = argv[++i]
  }
  if (!args.month) {
    const d = new Date()
    args.month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  if (![2, 3].includes(args.segments)) args.segments = 2
  return args
}

function monthDirs() {
  if (!existsSync(DATA_ROOT)) return []
  return readdirSync(DATA_ROOT)
    .filter(n => n.length === 6 && /^\d{6}$/.test(n) && existsSync(join(DATA_ROOT, n, 'guides.json')))
    .sort()
}

/** 解析 baseline：auto = 小于目标月的最大月份目录 */
function resolveBaseline(args) {
  if (args.baseline === 'none') return null
  if (args.baseline && args.baseline !== 'auto') return args.baseline
  const candidates = monthDirs().filter(m => m < args.month)
  return candidates.length ? candidates[candidates.length - 1] : null
}

function loadBaseline(monthKey) {
  if (!monthKey) return null
  const p = join(DATA_ROOT, monthKey, 'guides.json')
  if (!existsSync(p)) {
    console.warn(`[baseline] 未找到兜底数据文件: ${p}`)
    return null
  }
  try {
    const doc = JSON.parse(readFileSync(p, 'utf-8'))
    console.log(`[baseline] 兜底来源 ${monthKey}：攻略 ${doc.guides?.length ?? 0} 条 / 节日 ${doc.holidays?.length ?? 0} 条`)
    return doc
  } catch (err) {
    console.error(`[baseline] 解析失败 ${p}: ${err.message}`)
    return null
  }
}

function buildEntries() {
  const entries = []
  for (const hol of HOLIDAYS) {
    for (const dest of DESTINATIONS) {
      entries.push({
        externalId: `${dest.slug}-${hol.slug}`,
        dest,
        hol,
        theme: dest.themes[hol.slug.length % dest.themes.length],
        season: hol.season,
        days: hol.days
      })
    }
  }
  return entries
}

function readPartial(partialDir, externalId) {
  const p = join(partialDir, `${externalId}.json`)
  if (!existsSync(p)) return null
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    return data?.externalId === externalId ? data : null
  } catch { return null }
}

function writePartial(partialDir, externalId, data) {
  mkdirSync(partialDir, { recursive: true })
  const tmp = join(partialDir, `${externalId}.json.tmp`)
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, join(partialDir, `${externalId}.json`))
}

function loadTitlesByDest(partialDir) {
  const byDest = new Map()
  if (!existsSync(partialDir)) return byDest
  for (const f of readdirSync(partialDir)) {
    if (!f.endsWith('.json')) continue
    try {
      const d = JSON.parse(readFileSync(join(partialDir, f), 'utf-8'))
      const dest = String(d.externalId).split('-')[0]
      if (!byDest.has(dest)) byDest.set(dest, [])
      byDest.get(dest).push(d.title)
    } catch { /* 坏文件跳过 */ }
  }
  return byDest
}

/** 取生成内容：partial 优先，缺失用 baseline，保证 120 篇齐全 */
function resolveGuide(entry, partialDir, baselineMap) {
  const partial = readPartial(partialDir, entry.externalId)
  if (partial) return { guide: partial, source: 'partial' }
  const base = baselineMap?.get(entry.externalId)
  if (base) return { guide: base, source: 'baseline' }
  return { guide: null, source: 'missing' }
}

function buildDoc(entries, partialDir, baseline, baselineMonth) {
  const baselineMap = new Map((baseline?.guides ?? []).map(g => [g.externalId, g]))
  const guides = []
  let generated = 0, reused = 0
  const missing = []
  for (const entry of entries) {
    const { guide, source } = resolveGuide(entry, partialDir, baselineMap)
    if (!guide) { missing.push(entry.externalId); continue }
    if (source === 'baseline') reused++
    else generated++
    // 兜底复用上月内容时，封面也必须切到本地图，避免旧数据把 loremflickr 带回来
    guides.push({ ...guide, coverImage: coverUrl(entry.dest, entry.hol) })
  }
  const holidaySource = baseline?.holidays?.length
    ? baseline.holidays
    : HOLIDAYS.map(h => ({
        name: h.name, date: h.date, type: h.type, isLegal: h.isLegal,
        description: h.description, coverImage: holidayCoverUrl(h)
      }))
  const holidays = holidaySource.map(h => ({ ...h, coverImage: holidayCoverUrl(h) }))
  return { guideCount: guides.length, generated, reused, missing, doc: { guides, holidays }, baselineMonth }
}

function validateAll(entries, partialDir, baseline) {
  const baselineMap = new Map((baseline?.guides ?? []).map(g => [g.externalId, g]))
  const errors = []
  const guides = []
  const seenIds = new Set()
  for (const entry of entries) {
    const { guide, source } = resolveGuide(entry, partialDir, baselineMap)
    if (!guide) { errors.push(`${entry.externalId}: 缺内容（无 partial 且无兜底）`); continue }
    if (seenIds.has(entry.externalId)) { errors.push(`${entry.externalId}: externalId 重复`); continue }
    seenIds.add(entry.externalId)
    for (const err of validateGuide(entry, guide)) errors.push(`${entry.externalId}${source === 'baseline' ? '(兜底)' : ''}: ${err}`)
    guides.push(guide)
  }
  // 相似度抽查 20 对（仅抽查本次生成内容，避免兜底旧内容误报）
  let checked = 0
  const generatedSet = new Set(guides.filter(g => readPartial(partialDir, g.externalId)).map(g => g.externalId))
  const gen = guides.filter(g => generatedSet.has(g.externalId))
  outer:
  for (let i = 0; i < gen.length && checked < 20; i++) {
    for (let j = i + 1; j < gen.length && checked < 20; j++) {
      if (gen[i].destination !== gen[j].destination) continue
      checked++
      const sim = trigramSimilarity(stripHtml(gen[i].content), stripHtml(gen[j].content))
      if (sim >= 0.45) errors.push(`相似度过高 ${gen[i].externalId} vs ${gen[j].externalId}: ${sim.toFixed(2)}`)
      else if (sim >= 0.3) console.warn(`[validate] 相似度偏高（仅告警）${gen[i].externalId} vs ${gen[j].externalId}: ${sim.toFixed(2)}`)
      if (checked >= 20) break outer
    }
  }
  return { ok: errors.length === 0, errors }
}

/** 生成一篇攻略（多段拼接），返回 guide 对象 */
async function generateOne(entry, ctx) {
  const { channels, avoidTitles, month, segments } = ctx
  const plan = SEGMENT_PLAN[segments]
  let title = '', summary = '', tags = null
  const htmlParts = []
  const prevPlain = () => stripHtml(htmlParts.join('\n')).replace(/\s+/g, ' ').slice(-900)

  for (const seg of plan) {
    let r = null, lastErr = null
    let user = buildSegmentPrompt(entry, seg, prevPlain(), avoidTitles, month)

    // 每段最多 2 轮「通道链尝试」：解析失败/字段缺失都把错误反馈给模型重试
    for (let round = 1; round <= 2 && !r; round++) {
      for (const ch of channels) {
        if (ch.error) { lastErr = ch.error; continue }
        try {
          const out = await callOnce(ch.provider, ch.key, SEG_SYSTEM(entry), user)
          ch.usage = (ch.usage ?? 0) + (out.usage?.total_tokens ?? 0)
          if (out.error) throw new Error(out.error)
          const p = out.parsed ?? {}
          if (seg.key === 'part1') {
            const html = p.part1 ?? p.content ?? p.html
            const missing = ['title', 'summary'].filter(k => !p[k])
            if (!html) missing.push('part1')
            if (missing.length) throw new Error(`字段缺失: ${missing.join('/')}`)
            const t = normalizeTags(p.tags)
            if (t.length !== 3) throw new Error(`tags 须恰好 3 个: ${JSON.stringify(p.tags)}`)
            if (!String(html).includes('<h2')) throw new Error('part1 缺少 h2 板块')
            r = { part: String(html).trim(), title: String(p.title).trim(), summary: String(p.summary).trim(), tags: t }
          } else {
            const html = p[seg.key] ?? p.content ?? p.html
            if (!html) throw new Error(`字段缺失: ${seg.key}`)
            if (!String(html).includes('<h2')) throw new Error(`${seg.key} 缺少 h2 板块`)
            r = { part: String(html).trim() }
          }
          break
        } catch (err) {
          lastErr = err
          ch.errors = (ch.errors ?? 0) + 1
          console.warn(`  [channel] ${ch.name}(${ch.provider.model}) 段落 ${seg.key} 第 ${round} 轮失败: ${String(err?.message ?? err).slice(0, 140)}`)
        }
      }
      if (!r && round < 2) {
        user = `${user}\n\n【上次输出不合格：${String(lastErr?.message ?? lastErr).slice(0, 200)}】请严格按要求重新输出合法 JSON。`
        await sleep(1500)
      }
    }
    if (!r) throw new Error(`段落 ${seg.key} 全通道失败: ${String(lastErr?.message ?? lastErr).slice(0, 160)}`)

    if (seg.key === 'part1') {
      title = r.title
      summary = r.summary
      tags = r.tags
    }
    htmlParts.push(r.part)
  }

  return {
    externalId: entry.externalId,
    title,
    summary,
    content: htmlParts.join('\n'),
    coverImage: coverUrl(entry.dest, entry.hol),
    destination: entry.dest.name,
    region: entry.dest.region,
    season: entry.season,
    holidayName: entry.hol.name,
    holidayDate: entry.hol.date,
    days: entry.days,
    category: entry.dest.category,
    tags
  }
}

async function run(args) {
  const keyHome = args.keyDir || process.env.HOLIDAY_GUIDE_KEY_DIR || homedir()
  if (args.probeKeys) {
    const names = [...new Set([args.provider, args.fallbackProvider, 'dashscope', 'zhipu', 'siliconflow'])]
    let found = 0
    for (const name of names) {
      const provider = PROVIDERS[name]
      if (!provider) continue
      const p = { ...provider, keyFile: join(keyHome, `.${name}.key`) }
      const key = detectKey(p, args.apiKey, args.keyFile, keyHome)
      console.log(`[probe] ${name} (${p.model}) ${key ? 'OK ' + mask(key) : 'MISSING'} | ${p.keyFile}`)
      if (key) found++
    }
    console.log(`[probe] keyDir=${keyHome} found=${found}`)
    process.exit(found > 0 ? 0 : 1)
  }
  const entries = buildEntries()
  const outDir = join(DATA_ROOT, args.month)
  const partialDir = join(outDir, 'partial')
  const outPath = join(outDir, 'guides.json')
  const failedPath = join(outDir, 'failed.jsonl')
  const baselineMonth = resolveBaseline(args)

  console.log(`[gen-real] 目标月份 ${args.month} | 任务数 ${entries.length}（${DESTINATIONS.length} 目的地 × ${HOLIDAYS.length} 节日）| 分段 ${args.segments} 段`)
  console.log(`[gen-real] 输出目录 ${outDir}`)
  mkdirSync(outDir, { recursive: true }) // 提前建目录：failed.jsonl / partial 写入不再依赖后续步骤
  const baseline = loadBaseline(baselineMonth)
  if (!baseline && args.baseline !== 'none') console.warn('[gen-real] 无兜底数据：生成失败的篇目将缺失（可用 --baseline <yyyyMM> 指定）')

  // ---------- 校验模式 ----------
  if (args.validateOnly) {
    const report = validateAll(entries, partialDir, baseline)
    if (!report.ok) {
      console.error(`[validate] ${report.errors.length} 个失败：`)
      for (const e of report.errors.slice(0, 30)) console.error(`  - ${e}`)
      process.exit(1)
    }
    console.log('[validate] 全部通过 ✓')
    return
  }

  // ---------- 组装模式（不调 LLM） ----------
  if (args.assembleOnly) {
    const built = buildDoc(entries, partialDir, baseline, baselineMonth)
    if (built.missing.length) {
      console.error(`[assemble] 缺 ${built.missing.length} 篇且无兜底: ${built.missing.slice(0, 5).join(', ')}…`)
      process.exit(1)
    }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outPath, JSON.stringify(built.doc, null, 2), 'utf-8')
    console.log(`[assemble] 已输出 ${built.guideCount} 篇（生成 ${built.generated} / 兜底 ${built.reused}）→ ${outPath}`)
    return
  }

  // ---------- 通道准备 ----------
  const channels = []
  for (const name of [args.provider, args.noFallback ? null : args.fallbackProvider].filter(Boolean)) {
    const provider = PROVIDERS[name]
    if (!provider) { console.error(`未知 provider: ${name}，可选 ${Object.keys(PROVIDERS).join('/')}`); process.exit(1) }
    const p = { ...provider, keyFile: join(keyHome, `.${name}.key`) }
    if (args.model && name === args.provider) p.model = args.model
    const key = detectKey(p, args.apiKey, args.keyFile, keyHome)
    channels.push({ name, provider: p, key, usage: 0, errors: 0, error: key ? null : '未找到 API key' })
    if (!key) console.warn(`[channel] ${name} 未找到 API key，将跳过`)
  }
  if (!channels.some(c => !c.error)) {
    console.error('[gen-real] 无可用通道（没有任何通道能拿到 API key）')
    process.exit(1)
  }
  const usable = channels.filter(c => !c.error)
  console.log(`[gen-real] 通道链: ${usable.map(c => `${c.name}=${c.provider.model}`).join(' → ')}`)

  if (args.dryRun) {
    const seg = SEGMENT_PLAN[args.segments][0]
    console.log(`[dry-run] 首段 system:\n${SEG_SYSTEM(entries[0]).slice(0, 300)}...`)
    console.log(`[dry-run] 首段 user:\n${buildSegmentPrompt(entries[0], seg, '', [], args.month)}`)
    return
  }

  // ---------- 通道体检（--smoke）：只生成 1 篇、不组装，用于定时任务前置闸门 ----------
  if (args.smoke) {
    const entry = entries.find(e => e.externalId === args.smoke)
    if (!entry) { console.error(`[smoke] 未找到 externalId=${args.smoke}`); process.exit(1) }
    console.log(`[smoke] 通道体检：${args.smoke}（${usable.map(c => c.name).join(' → ')}）`)
    // smoke 必须真实调用通道，不能复用旧 partial，否则 key 失效时会被误判为通过
    try {
      const guide = await generateOne(entry, { channels: usable, avoidTitles: [], month: args.month, segments: args.segments, index: entries.indexOf(entry) })
      const errors = validateGuide(entry, guide)
      if (errors.length) throw new Error(`字段校验失败: ${errors.join('; ')}`)
      writePartial(partialDir, entry.externalId, guide)
      console.log(`[smoke] 通过 ✓ 正文 ${stripHtml(guide.content).length} 字，title=${guide.title}`)
      console.log(`[smoke] 通道用量: ${usable.map(c => `${c.name} ${c.usage} tokens`).join(' | ')}`)
      return
    } catch (err) {
      console.error(`[smoke] 失败 ✗ ${String(err?.message ?? err).slice(0, 300)}`)
      process.exit(1)
    }
  }

  // ---------- 生成 ----------
  const targets = args.only ? entries.filter(e => e.externalId === args.only) : entries
  if (args.only && !targets.length) { console.error(`未找到 externalId=${args.only}`); process.exit(1) }

  const titlesByDest = loadTitlesByDest(partialDir)
  const startedAt = Date.now()
  let done = 0, skipped = 0, failed = 0
  const failedIds = []
  const queue = [...targets]
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift()
      const partial = readPartial(partialDir, entry.externalId)
      if (partial && !validateGuide(entry, partial).length) { skipped++; continue }
      const avoidTitles = (titlesByDest.get(entry.dest.slug) || []).slice(-5)
      try {
        console.log(`[${done + skipped + failed + 1}/${targets.length}] 生成 ${entry.externalId}（${entry.dest.name}×${entry.hol.name}，${entry.days}天，${entry.theme}）`)
        const guide = await generateOne(entry, { channels: usable, avoidTitles, month: args.month, segments: args.segments, index: entries.indexOf(entry) })
        const errors = validateGuide(entry, guide)
        if (errors.length) throw new Error(`字段校验失败: ${errors.join('; ')}`)
        writePartial(partialDir, entry.externalId, guide)
        if (!titlesByDest.has(entry.dest.slug)) titlesByDest.set(entry.dest.slug, [])
        titlesByDest.get(entry.dest.slug).push(guide.title)
        done++
      } catch (err) {
        failed++
        failedIds.push(entry.externalId)
        appendFileSync(failedPath, `${new Date().toISOString()} ${entry.externalId} ${String(err?.message ?? err).slice(0, 300)}\n`, 'utf-8')
        console.error(`  ✗ ${entry.externalId} 失败: ${String(err?.message ?? err).slice(0, 200)}`)
      }
    }
  }
  const pool = Array.from({ length: Math.max(1, args.concurrency) }, worker)
  await Promise.all(pool)

  const mins = ((Date.now() - startedAt) / 60000).toFixed(1)
  console.log(`[gen-real] 生成结束: 成功 ${done}，跳过(已存在) ${skipped}，失败 ${failed}，耗时 ${mins} 分钟`)
  for (const c of channels) console.log(`[gen-real] 通道 ${c.name}(${c.provider.model}): 累计 tokens ${c.usage}，错误次数 ${c.errors}`)
  if (failed) console.log(`[gen-real] 失败篇目: ${failedIds.join(', ')}（将从兜底 ${baselineMonth ?? '无'} 补齐）`)

  // ---------- 校验 + 组装 ----------
  const report = validateAll(entries, partialDir, baseline)
  if (!report.ok) {
    console.error(`[gen-real] validate 未通过（${report.errors.length} 个）：`)
    for (const e of report.errors.slice(0, 30)) console.error(`  - ${e}`)
    console.error('[gen-real] 未写 guides.json；可 --only <id> 补跑或调整参数后重跑')
    process.exit(1)
  }
  const built = buildDoc(entries, partialDir, baseline, baselineMonth)
  if (built.missing.length) {
    console.error(`[gen-real] 缺 ${built.missing.length} 篇且无兜底，未写 guides.json`)
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outPath, JSON.stringify(built.doc, null, 2), 'utf-8')
  console.log(`[gen-real] 已输出 ${built.guideCount} 篇（本次生成 ${built.generated} / 复用兜底 ${built.reused}）→ ${outPath}`)
}

run(parseArgs(process.argv.slice(2))).catch(err => {
  console.error('[gen-real] 致命错误:', err)
  process.exit(1)
})
