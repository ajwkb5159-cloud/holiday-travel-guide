import axios from 'axios'
import { Message } from 'element-ui'

// 统一解包后端 ApiResult{Code,Msg,Data}：Code=0 直接返回 Data，否则弹错并 reject
const http = axios.create({ timeout: 15000 })

http.interceptors.response.use(
  (resp) => {
    const body = resp.data
    if (body && typeof body === 'object' && 'Code' in body) {
      if (body.Code === 0) return body.Data
      Message.error(body.Msg || '请求失败')
      return Promise.reject(new Error(body.Msg || '请求失败'))
    }
    return body
  },
  (err) => {
    // 503 = 服务门拦截（更新中/维护中），提示「服务器繁忙」；其余归为网络异常
    const status = err.response && err.response.status
    if (status === 503) {
      Message.error('服务器繁忙，请稍后重试')
    } else {
      Message.error('网络异常，请稍后重试')
    }
    return Promise.reject(err)
  }
)

export default http
