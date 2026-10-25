const KEY = 'holiday-guide-search-history'
const MAX = 10

let mem = null

function readRaw() {
  try {
    const v = localStorage.getItem(KEY)
    return v ? JSON.parse(v) : []
  } catch (e) {
    return []
  }
}

function write(list) {
  mem = list
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch (e) {
    /* 忽略隐私模式写入失败 */
  }
}

export function getSearchHistory() {
  if (mem == null) mem = readRaw()
  return [...mem]
}

export function addSearchHistory(q) {
  const kw = (q || '').trim()
  if (!kw) return
  const cur = getSearchHistory()
  const next = [kw, ...cur.filter(x => x !== kw)]
  write(next.slice(0, MAX))
}

export function clearSearchHistory() {
  write([])
}