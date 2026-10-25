// 按路由 meta.title 设 document.title，统一品牌后缀
const BRAND = '节假日旅游攻略'

export function setDocumentTitle(title) {
  document.title = title ? `${title} · ${BRAND}` : BRAND
}