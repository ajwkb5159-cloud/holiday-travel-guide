import http from './http'

export const searchGuides = (q, limit = 20) => http.get('/api/search', { params: { q, limit } })
export const suggest = (q) => http.get('/api/search/suggest', { params: { q } })
