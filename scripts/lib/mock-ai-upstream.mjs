// 本地 mock OpenAI 兼容上游：用于验证解析器对空 choices、reasoning chunk、非 SSE 200 的健壮性。
// 不联网、不消耗额度。
import { createServer } from 'node:http'

/**
 * @param {{mode?: 'sse'|'json', port?: number, content?: string}} opts
 * @returns {Promise<{server: import('node:http').Server, port: number, baseUrl: string, close: () => Promise<void>}>}
 */
export async function startMockAi(opts = {}) {
  const mode = opts.mode || 'sse'
  const content = opts.content || '这是模拟回答 [1]'
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let model = 'mock'
      try { model = JSON.parse(body).model || model } catch { /* ignore */ }

      if (mode === 'json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          id: 'mock-json',
          model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        }))
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
      send({ id: 'mock-sse', model, choices: [], usage: { prompt_tokens: 10, total_tokens: 10 } })
      send({ id: 'mock-sse', model, choices: [{ index: 0, delta: { reasoning_content: '先想一想。' } }] })
      send({ id: 'mock-sse', model, choices: [{ index: 0, delta: { content: '这是' } }] })
      send({ id: 'mock-sse', model, choices: [{ index: 0, delta: { content: content.replace('这是', '') }, finish_reason: 'stop' }] })
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })

  await new Promise((resolve) => server.listen(opts.port || 0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
