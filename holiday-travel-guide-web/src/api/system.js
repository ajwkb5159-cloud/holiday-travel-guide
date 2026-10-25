import http from './http'

// 系统公开状态：Mode=normal|updating|maintenance，LastPublishTime 等发布元数据
export const getSystemStatus = () => http.get('/api/system/status')
