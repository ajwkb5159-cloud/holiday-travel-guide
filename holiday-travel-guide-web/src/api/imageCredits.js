// 图片来源/许可查询：credits.json 是静态资产，模块级缓存，避免每个详情页重复请求。
// 封面 URL 可能带 ?v=yyyyMM，查表时统一剥离 query string。

let cache = null
let pending = null

export function coverPath(url) {
  return String(url || '').split('?')[0]
}

async function loadCredits() {
  if (cache) return cache
  if (pending) return pending
  pending = fetch('/images/credits.json')
    .then((resp) => (resp.ok ? resp.json() : { images: [] }))
    .then((doc) => {
      cache = new Map((doc.images || []).map((x) => [coverPath(x.path), x]))
      return cache
    })
    .catch(() => {
      cache = new Map()
      return cache
    })
    .finally(() => {
      pending = null
    })
  return pending
}

export async function getImageCredit(url) {
  if (!url) return null
  const map = await loadCredits()
  return map.get(coverPath(url)) || null
}
