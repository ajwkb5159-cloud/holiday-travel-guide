// 浏览行为采集（localStorage，与收藏同思路：纯前端信号，无后端埋点写接口）
// 供首页「猜你喜欢」个性化推荐使用；隐私友好，用户清空 localStorage 即可重置画像。

const KEY = 'holiday-guide-behavior'
const MAX = 200 // 上限防膨胀；保留最新

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch (e) { /* 隐私模式/配额满：静默失败 */ }
}

/**
 * 记录一次攻略浏览（详情页 load 成功后调用）
 * @param {{Id:number, Destination:string, Category:string, Tags:string, Season:string}} guide 后端 GuideDetailDto（PascalCase）
 */
export function recordGuideView(guide) {
  if (!guide || !guide.Id) return
  try {
    const list = load().filter(x => x.id !== guide.Id)
    list.unshift({
      id: guide.Id,
      destination: guide.Destination || '',
      category: guide.Category || '',
      tags: String(guide.Tags || '').split(',').filter(Boolean),
      season: guide.Season || '',
      ts: Date.now()
    })
    save(list.slice(0, MAX))
  } catch (e) { /* 忽略 */ }
}

/** 是否有足够信号展示推荐模块（至少看过 1 篇或有收藏） */
export function hasBehaviorSignals(favoriteIds = []) {
  return load().length > 0 || favoriteIds.length > 0
}

/**
 * 汇总兴趣信号（近 60 天窗口内，越新权重越高）：
 * destinations/categories/tags 按出现频次取 TopN；excludeIds 用于结果去重已读。
 * 收藏 id 一并并入 excludeIds（推荐「没看过的」更有价值）。
 */
export function getBehaviorSignals(favoriteIds = []) {
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000
  const recent = load().filter(x => x.ts >= cutoff)
  const bump = (map, key, weight) => {
    if (!key) return
    map[key] = (map[key] || 0) + weight
  }
  const destMap = {}, catMap = {}, tagMap = {}
  recent.forEach((x, i) => {
    // 越新的记录权重越高（线性衰减）
    const w = 1 + (recent.length - i) / recent.length
    bump(destMap, x.destination, w)
    bump(catMap, x.category, w)
    ;(x.tags || []).forEach(t => bump(tagMap, t, w))
  })
  const top = (m, n) => Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, n)
  return {
    destinations: top(destMap, 3),
    categories: top(catMap, 2),
    tags: top(tagMap, 6),
    viewedIds: recent.map(x => x.id),
    excludeIds: [...new Set([...recent.map(x => x.id), ...favoriteIds])]
  }
}

/** 清空行为画像（预留：设置页可用） */
export function clearBehavior() {
  try { localStorage.removeItem(KEY) } catch (e) { /* 忽略 */ }
}
