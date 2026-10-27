// OpenCode Go / OpenAI 兼容端点探测：不修改任何配置，只发少量真实请求并记录结果。
//
// 用法：
//   node scripts/probe-ai-provider.mjs
//   node scripts/probe-ai-provider.mjs --key-file F:\HolidayGuide\secrets\opencode.key
//   node scripts/probe-ai-provider.mjs --api-key sk-... --base-url ... --model deepseek-v4.1-flash
//
// 结果写到 .test-env/ai-probe/result.json；日志只显示 masked key，不落盘明文。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASE = 'https://opencode.ai/zen/go/v1/chat/completions'
const DEFAULT_MODEL = 'deepseek-v4.1-flash'
const SECRET_FILE = 'F:\\HolidayGuide\\secrets\\opencode.key'
const PI_AUTH = join(homedir(), '.pi', 'agent', 'auth.json')

const mask = (k) => k ? `****${k.slice(-4)}` : '(未找到)'

function parseArgs(argv) {
  const args = {
    keyFile: null, apiKey: null, baseUrl: DEFAULT_BASE, model: DEFAULT_MODEL,
    timeout: 90000, maxTokens: 512, sessionId: `hg-probe-${Date.now()}`
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--key-file') args.keyFile = argv[++i]
    else if (a === '--api-key') args.apiKey = argv[++i]
    else if (a === '--base-url') args.baseUrl = argv[++i]
    else if (a === '--model') args.model = argv[++i]
    else if (a === '--timeout') args.timeout = Number(argv[++i])
    else if (a === '--max-tokens') args.maxTokens = Number(argv[++i])
    else if (a === '--session') args.sessionId = argv[++i]
  }
  return args
}

function parseKey(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (text.startsWith('{')) {
    try {
      const doc = JSON.parse(text)
      return String(doc?.['opencode-go']?.key || '').trim()
    } catch { return '' }
  }
  return text
}

function readKeyFile(path) {
  try {
    if (path && existsSync(path)) return parseKey(readFileSync(path, 'utf-8'))
  } catch { /* ignore */ }
  return ''
}

function readPiKey() {
  return readKeyFile(PI_AUTH)
}

const redact = (text, key) => key ? String(text).split(key).join('****') : String(text)

function resolveKey(args) {
  if (args.apiKey) return { key: args.apiKey, source: '--api-key' }
  const file = args.keyFile || process.env.OPENCODE_API_KEY_FILE || SECRET_FILE
  const fromFile = readKeyFile(file)
  if (fromFile) return { key: fromFile, source: file }
  const env = process.env.OPENCODE_GO_API_KEY || process.env.OPENCODE_API_KEY || ''
  if (env) return { key: env.trim(), source: 'env' }
  const pi = readPiKey()
  if (pi) return { key: pi, source: PI_AUTH }
  return { key: '', source: '(none)' }
}

async function readSse(resp) {
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let reasoning = ''
  let finishReason = null
  let chunks = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const data = JSON.parse(payload)
          const choice = data?.choices?.[0]
          if (!choice) continue
          chunks++
          if (choice.finish_reason) finishReason = choice.finish_reason
          const d = choice.delta || choice.message || {}
          if (typeof d.content === 'string') content += d.content
          if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content
        } catch { /* 忽略坏行 */ }
      }
    }
  }
  return { content, reasoning, finishReason, chunks }
}

async function probeOnce({ name, args, key, messages, stream = true, maxTokens }) {
  const body = {
    model: args.model,
    messages,
    stream,
    temperature: 0.3,
    max_tokens: maxTokens ?? args.maxTokens
  }
  const started = Date.now()
  try {
    const resp = await fetch(args.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        Accept: 'text/event-stream',
        'User-Agent': 'HolidayTravelGuideProbe/1.0',
        'x-opencode-session': args.sessionId
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(args.timeout)
    })
    const contentType = resp.headers.get('content-type') || ''
    const base = { name, status: resp.status, contentType, httpOk: resp.ok, baseUrl: args.baseUrl, model: args.model }
    if (!resp.ok) {
      const text = redact((await resp.text()).slice(0, 800), key)
      return { ...base, errorBody: text, durationMs: Date.now() - started }
    }
    if (contentType.includes('text/event-stream')) {
      const out = await readSse(resp)
      return { ...base, stream: true, ...out, durationMs: Date.now() - started }
    }
    const text = await resp.text()
    let content = '', reasoning = '', finishReason = null
    try {
      const data = JSON.parse(text)
      const msg = data?.choices?.[0]?.message || {}
      content = msg.content || ''
      reasoning = msg.reasoning_content || ''
      finishReason = data?.choices?.[0]?.finish_reason || null
    } catch { /* 非 JSON */ }
    return { ...base, stream: false, content, reasoning, finishReason, rawPreview: redact(text.slice(0, 500), key), durationMs: Date.now() - started }
  } catch (err) {
    return { name, error: redact(String(err?.message ?? err), key), durationMs: Date.now() - started }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { key, source } = resolveKey(args)
  if (!key) {
    console.error('[probe-ai] 未找到 key；检查 --key-file / OPENCODE_API_KEY_FILE / F:\\HolidayGuide\\secrets\\opencode.key')
    process.exit(1)
  }

  console.log(`[probe-ai] base=${args.baseUrl}`)
  console.log(`[probe-ai] model=${args.model} key=${mask(key)} source=${source}`)

  const system = '你是简洁的旅行助手，用简体中文回答。'
  const single = await probeOnce({
    name: 'single-turn',
    args,
    key,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: '用一句话介绍北京故宫。' }
    ]
  })
  console.log(`[probe-ai] single-turn: status=${single.status ?? 'ERR'} type=${single.contentType || '-'} content=${(single.content || '').length} reasoning=${(single.reasoning || '').length} finish=${single.finishReason || '-'}${single.error ? ' error=' + single.error : ''}`)

  const assistantReply = single.content || '故宫是北京最著名的皇家宫殿建筑群。'
  const multiNoReasoning = await probeOnce({
    name: 'multi-turn-without-reasoning',
    args,
    key,
    maxTokens: Math.min(args.maxTokens, 256),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: '北京有什么必去的景点？' },
      { role: 'assistant', content: assistantReply },
      { role: 'user', content: '再补充一个适合亲子的。' }
    ]
  })
  console.log(`[probe-ai] multi-turn(no reasoning): status=${multiNoReasoning.status ?? 'ERR'} content=${(multiNoReasoning.content || '').length} finish=${multiNoReasoning.finishReason || '-'}${multiNoReasoning.error ? ' error=' + multiNoReasoning.error : ''}`)
  if (multiNoReasoning.errorBody) console.log(`[probe-ai]   errorBody=${multiNoReasoning.errorBody.slice(0, 300)}`)

  const reasoningText = single.reasoning || '用户想了解北京故宫，需要用一句话概括。'
  const multiWithReasoning = await probeOnce({
    name: 'multi-turn-with-reasoning',
    args,
    key,
    maxTokens: Math.min(args.maxTokens, 256),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: '北京有什么必去的景点？' },
      { role: 'assistant', content: assistantReply, reasoning_content: reasoningText },
      { role: 'user', content: '再补充一个适合亲子的。' }
    ]
  })
  console.log(`[probe-ai] multi-turn(with reasoning): status=${multiWithReasoning.status ?? 'ERR'} content=${(multiWithReasoning.content || '').length} finish=${multiWithReasoning.finishReason || '-'}${multiWithReasoning.error ? ' error=' + multiWithReasoning.error : ''}`)
  if (multiWithReasoning.errorBody) console.log(`[probe-ai]   errorBody=${multiWithReasoning.errorBody.slice(0, 300)}`)

  const multiEmptyReasoning = await probeOnce({
    name: 'multi-turn-empty-reasoning',
    args,
    key,
    maxTokens: Math.min(args.maxTokens, 256),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: '北京有什么必去的景点？' },
      { role: 'assistant', content: assistantReply, reasoning_content: '' },
      { role: 'user', content: '再补充一个适合亲子的。' }
    ]
  })
  console.log(`[probe-ai] multi-turn(empty reasoning): status=${multiEmptyReasoning.status ?? 'ERR'} content=${(multiEmptyReasoning.content || '').length} finish=${multiEmptyReasoning.finishReason || '-'}${multiEmptyReasoning.error ? ' error=' + multiEmptyReasoning.error : ''}`)
  if (multiEmptyReasoning.errorBody) console.log(`[probe-ai]   errorBody=${multiEmptyReasoning.errorBody.slice(0, 300)}`)

  const outDir = join(ROOT, '.test-env', 'ai-probe')
  mkdirSync(outDir, { recursive: true })
  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    model: args.model,
    keySource: source,
    keyMasked: mask(key),
    single,
    multiNoReasoning,
    multiWithReasoning,
    multiEmptyReasoning,
    hints: []
  }
  if (single.status === 200 && single.content) result.hints.push('单轮可用；正文在 delta.content/ message.content')
  if (single.reasoning) result.hints.push('上游会返回 reasoning_content；若多轮 400，设置 Ai:SendReasoningContent=true')
  if (multiNoReasoning.status === 400) result.hints.push('多轮不带 reasoning_content 被拒；需要透传推理内容')
  if (multiNoReasoning.status === 200) result.hints.push('多轮不带 reasoning_content 可用；可先只改配置')
  if (multiEmptyReasoning.status === 200) result.hints.push('空 reasoning_content 可用；无推理的 assistant 轮可补空串')
  if (multiEmptyReasoning.status === 400) result.hints.push('空 reasoning_content 被拒；需要真实推理内容或去掉历史')
  if (single.finishReason === 'length') result.hints.push('max_tokens 可能被推理 token 吃掉；提高 Ai:MaxTokens')
  if (single.status === 401 || single.status === 403) result.hints.push('鉴权失败；检查 key 与端点是否匹配')
  if (single.status === 404) result.hints.push('端点 404；确认 BaseURL 是完整 /v1/chat/completions')
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8')
  console.log(`[probe-ai] 结果写入 ${join(outDir, 'result.json')}`)
  for (const h of result.hints) console.log(`[probe-ai] hint: ${h}`)
}

main().catch(err => {
  console.error('[probe-ai] 致命错误:', err)
  process.exit(1)
})
