import http from './http'

export const getHome = () => http.get('/api/guide/home')
export const getGuides = (params) => http.get('/api/guide', { params })
export const getGuideDetail = (id) => http.get(`/api/guide/${id}`)
export const getRanking = (type = 'hot', limit = 10) => http.get('/api/guide/ranking', { params: { type, limit } })
export const getSeasonal = (season, limit = 10) => http.get('/api/guide/seasonal', { params: { season, limit } })

// 个性化推荐「猜你喜欢」：参数为 localStorage 行为信号（逗号分隔）
export const getRecommend = ({ destinations, categories, tags, excludeIds, limit = 8 }) =>
  http.get('/api/guide/recommend', {
    params: {
      destinations: (destinations || []).join(','),
      categories: (categories || []).join(','),
      tags: (tags || []).join(','),
      excludeIds: (excludeIds || []).join(','),
      limit
    }
  })
