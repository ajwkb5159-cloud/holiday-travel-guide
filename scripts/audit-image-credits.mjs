// 离线/在线图片署名审计：每个封面都要有 credit、许可白名单、来源页、本地 JPEG。
// 用法：
//   node scripts/audit-image-credits.mjs
//   node scripts/audit-image-credits.mjs --base http://127.0.0.1:5199
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IMAGES = join(ROOT, 'holiday-travel-guide-web', 'public', 'images')
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'scripts', 'data', 'image-manifest.json'), 'utf-8'))
const ALLOWED = /^(CC0|Public domain|CC BY(?:-SA)?|PD\b)/i

const args = { base: null }
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--base') args.base = process.argv[++i]
}

function expectedPaths() {
  const paths = []
  for (const city of MANIFEST.attractions) {
    for (const slot of city.slots) {
      paths.push(`/images/destinations/${city.slug}-${String(slot.slot).padStart(2, '0')}.jpg`)
    }
  }
  for (const h of MANIFEST.holidays) paths.push(`/images/holidays/${h.slug}.jpg`)
  return paths
}

function isJpeg(buf) {
  return buf.length > 20 * 1024 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

async function main() {
  const creditsPath = join(IMAGES, 'credits.json')
  if (!existsSync(creditsPath)) {
    console.error(`[credits] 缺少 ${creditsPath}`)
    process.exit(1)
  }
  const doc = JSON.parse(readFileSync(creditsPath, 'utf-8'))
  const byPath = new Map((doc.images || []).map(x => [x.path, x]))
  const errors = []
  const warnings = []

  for (const p of expectedPaths()) {
    const file = join(IMAGES, p.replace(/^\/images\//, ''))
    if (!existsSync(file)) {
      errors.push(`缺文件: ${p}`)
      continue
    }
    const buf = readFileSync(file)
    if (!isJpeg(buf)) errors.push(`不是有效 JPEG 或过小: ${p} (${buf.length} bytes)`)
    const credit = byPath.get(p)
    if (!credit) {
      errors.push(`缺署名: ${p}`)
      continue
    }
    if (!ALLOWED.test(String(credit.license || ''))) errors.push(`许可不在白名单: ${p} → ${credit.license}`)
    if (!String(credit.sourcePage || '').startsWith('https://commons.wikimedia.org/')) errors.push(`来源页不是 Commons: ${p} → ${credit.sourcePage}`)
    if (!credit.artist) warnings.push(`作者为空: ${p}`)
    if (args.base) {
      const url = `${args.base.replace(/\/$/, '')}${p}`
      try {
        const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
        if (!resp.ok) errors.push(`HTTP ${resp.status}: ${url}`)
        const type = resp.headers.get('content-type') || ''
        if (!type.includes('image/jpeg')) warnings.push(`Content-Type 非 JPEG: ${url} → ${type}`)
      } catch (err) {
        errors.push(`请求失败 ${url}: ${err.message}`)
      }
    }
  }

  for (const w of warnings.slice(0, 20)) console.warn(`  [warn] ${w}`)
  if (errors.length) {
    console.error(`[credits] 失败 ${errors.length} 项：`)
    for (const e of errors.slice(0, 50)) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log(`[credits] 全部通过 ✓ ${expectedPaths().length} 张图均有合法署名与本地文件`)
}

main().catch(err => {
  console.error('[credits] 致命错误:', err)
  process.exit(1)
})
