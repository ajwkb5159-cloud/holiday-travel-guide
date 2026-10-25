import dayjs from 'dayjs'

export const formatDate = (date, pattern = 'YYYY-MM-DD') => (date ? dayjs(date).format(pattern) : '')

// 距目标日期还有多少天（负数 = 已过）
export const daysUntil = (date) => dayjs(date).startOf('day').diff(dayjs().startOf('day'), 'day')

export const countdownText = (date) => {
  const diff = daysUntil(date)
  if (diff < 0) return '已过'
  if (diff === 0) return '就是今天'
  return `还有 ${diff} 天`
}
