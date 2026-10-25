// 月份 → 季节（与后端口径一致：3-5 春 / 6-8 夏 / 9-11 秋 / 冬）
export const seasonOfMonth = (month = new Date().getMonth() + 1) => {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

export const SEASON_LABELS = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }
