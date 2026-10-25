import http from './http'

export const getHolidays = () => http.get('/api/holiday')
export const getCountdown = (days = 365) => http.get('/api/holiday/countdown', { params: { days } })
