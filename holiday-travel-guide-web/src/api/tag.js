import http from './http'

export const getTags = (limit = 50) => http.get('/api/tag', { params: { limit } })
