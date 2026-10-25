import Vue from 'vue'
import Vuex from 'vuex'

Vue.use(Vuex)

const FAV_KEY = 'holiday-guide-favorites'

// 旧版收藏是裸 id 数组 [id,...]，新版是对象数组 [{id, addedAt}]
// 兼容迁移：读到旧格式自动升级为对象数组并回写，加入顺序保留（按原数组顺序补 addedAt）
const loadFavorites = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY))
    if (!Array.isArray(raw)) return []
    // 已是对象数组
    if (raw.length && typeof raw[0] === 'object') return raw
    // 旧裸 id 数组 → 迁移
    const migrated = raw.map((id, i) => ({ id, addedAt: i }))
    localStorage.setItem(FAV_KEY, JSON.stringify(migrated))
    return migrated
  } catch (e) {
    return []
  }
}

export default new Vuex.Store({
  state: {
    favorites: loadFavorites()
  },
  getters: {
    // isFavorite 兼容调用方可能传数值 id
    isFavorite: (state) => (id) => state.favorites.some(f => f.id === id),
    favoriteIds: (state) => state.favorites.map(f => f.id)
  },
  mutations: {
    toggleFavorite(state, id) {
      const idx = state.favorites.findIndex(f => f.id === id)
      if (idx >= 0) {
        state.favorites.splice(idx, 1)
      } else {
        // 加在最末；addedAt 用 Date.now 保证按收藏时间排序稳定
        state.favorites.push({ id, addedAt: Date.now() })
      }
      localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites))
    }
  }
})