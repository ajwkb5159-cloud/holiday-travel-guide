import DOMPurify from 'dompurify'

// 注册一次全局钩子：净化后给所有 img 加 loading=lazy + decoding=async + referrerpolicy，并绑 onError 兜底
// 详情正文是后端 HTML v-html 直染，DOMPurify 先剥脚本/事件属性，再靠此钩子补上懒加载与图片失败兜底
let hooked = false
function ensureHook() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy')
      node.setAttribute('decoding', 'async')
      node.setAttribute('referrerpolicy', 'no-referrer')
      // 图片加载失败：替换为透明占位，露出节点容器背景兜底色；不留 broken image 图标
      node.setAttribute('onerror', "this.style.visibility='hidden'")
    }
  })
}

/**
 * 清洗后端 HTML 攻略正文：剥 script/事件属性/xss 注入，并给内嵌图片补懒加载与失败兜底。
 * 仅允许正文排版需要的标签与属性（USE_PROFILES html）。
 */
export function sanitizeGuideContent(html) {
  if (!html) return ''
  ensureHook()
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'loading', 'decoding', 'referrerpolicy', 'onerror']
  })
}