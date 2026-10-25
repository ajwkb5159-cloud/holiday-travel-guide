import http from './http'

export const getDestinations = (params) => http.get('/api/destination', { params })
export const getDestinationDetail = (name) => http.get(`/api/destination/${encodeURIComponent(name)}`)
