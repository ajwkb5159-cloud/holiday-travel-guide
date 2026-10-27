// AI 行程助手 API：SSE 流式用原生 fetch + ReadableStream 手写解析（axios 浏览器端不支持流式）
// 后端事件协议：event: delta|sources|done|error + data: JSON（PascalCase，与站内 API 一致）

const BASE = '/api/ai'

async function readError(resp) {
  let msg = '网络异常，请稍后重试'
  let data = null
  try {
    const body = await resp.json()
    msg = (body && (body.Msg || body.msg)) || msg
    data = (body && (body.Data || body.data)) || null
  } catch (e) { /* 非 JSON 响应体 */ }
  const err = new Error(msg)
  err.status = resp.status
  err.data = data
  return err
}

/** 探测 AI 功能开关（悬浮球挂载依据；网络失败视为关闭） */
export async function getAiStatus() {
  try {
    const resp = await fetch(`${BASE}/status`)
    if (!resp.ok) return { Enabled: false }
    const body = await resp.json()
    const d = body.Data || body.data || {}
    return { Enabled: !!(d.Enabled ?? d.enabled) }
  } catch (e) {
    return { Enabled: false }
  }
}

/** 查询今日剩余咨询次数 */
export async function getAiQuota() {
  const resp = await fetch(`${BASE}/quota`)
  if (!resp.ok) throw await readError(resp)
  const body = await resp.json()
  return body.Data || body.data
}

/**
 * 流式问答。
 * @param {object} o
 * @param {string} o.question 用户问题
 * @param {Array<{role:string,content:string}>} [o.history] 最近上下文
 * @param {(text:string)=>void} [o.onDelta] 增量文本
 * @param {(text:string)=>void} [o.onReasoning] 推理增量（不展示，仅用于多轮历史回传）
 * @param {(sources:Array)=>void} [o.onSources] 引用攻略列表 [{Index,Id,Title,Destination,CoverImage}]
 * @param {(payload:{Limit:number,Remaining:number})=>void} [o.onDone] 正常结束
 * @param {AbortSignal} [o.signal] 中断
 */
export async function streamChat({ question, history, onDelta, onReasoning, onSources, onDone, signal }) {
  const resp = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Question: question, History: history || [] }),
    signal
  })

  // 非 200：额度/繁忙/未开启等以 JSON 返回，抛出带状态码的错误由 UI 分型提示
  if (!resp.ok) {
    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
      const err = new Error('服务器繁忙，请稍后重试')
      err.status = resp.status
      throw err
    }
    throw await readError(resp)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''

  const dispatch = (block) => {
    let evt = 'message'
    const datas = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) evt = line.slice(6).trim()
      else if (line.startsWith('data:')) datas.push(line.slice(5).trim())
    }
    if (!datas.length) return
    let payload
    try { payload = JSON.parse(datas.join('\n')) } catch (e) { payload = null }
    if (payload === null) return
    if (evt === 'delta' && onDelta && payload.Text != null) onDelta(payload.Text)
    else if (evt === 'reasoning' && onReasoning && payload.Text != null) onReasoning(payload.Text)
    else if (evt === 'sources' && onSources) onSources(payload || [])
    else if (evt === 'done' && onDone) onDone(payload || {})
    else if (evt === 'error') {
      const err = new Error(payload.Message || 'AI 服务暂时不可用')
      err.aiError = true
      throw err
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      dispatch(block)
    }
  }
}
