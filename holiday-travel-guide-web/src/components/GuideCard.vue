<template>
  <div class="guide-card" @click="goDetail">
    <div class="card-cover" :style="coverStyle">
      <span v-if="guide.Season" class="season-badge" :class="'season-' + guide.Season">
        {{ seasonLabel }}
      </span>
      <button class="fav-btn" :title="isFav ? '取消收藏' : '收藏'" @click.stop="toggleFav">
        {{ isFav ? '❤️' : '🤍' }}
      </button>
    </div>
    <div class="card-body">
      <h3 class="card-title" v-html="highlightTitle"></h3>
      <p class="card-summary" v-html="highlightSummary"></p>
      <div class="card-meta">
        <span class="meta-item">📍 {{ guide.Destination }}</span>
        <span v-if="guide.Days" class="meta-item">🕐 {{ guide.Days }} 天</span>
        <span v-if="guide.ViewCount !== undefined" class="meta-item">👀 {{ guide.ViewCount }}</span>
      </div>
      <div v-if="tagList.length" class="card-tags">
        <el-tag v-for="tag in tagList.slice(0, 4)" :key="tag" size="mini" effect="plain">{{ tag }}</el-tag>
      </div>
    </div>
  </div>
</template>

<script>
import { SEASON_LABELS } from '@/utils/season'

export default {
  name: 'GuideCard',
  props: {
    guide: { type: Object, required: true },
    highlight: { type: String, default: '' }
  },
  computed: {
    coverStyle() {
      // 双层背景：url 在上、季节渐变在下——图加载失败自动透出渐变兜底
      return { backgroundImage: `url(${this.guide.CoverImage || ''}), var(--season-gradient)` }
    },
    // 命中高亮：先把内容转义防 XSS，再用 <em class="hl"> 包裹关键词（转义RegExp特殊字符）
    highlightTitle() {
      return this.wrap(this.guide.Title, this.highlight)
    },
    highlightSummary() {
      return this.wrap(this.guide.Summary, this.highlight)
    },
    tagList() {
      const tags = this.guide.Tags
      if (!tags) return []
      return Array.isArray(tags) ? tags : String(tags).split(',').filter(Boolean)
    },
    seasonLabel() {
      return SEASON_LABELS[this.guide.Season] || this.guide.Season || ''
    },
    isFav() {
      return this.$store.getters.isFavorite(this.guide.Id)
    }
  },
  methods: {
    escapeHtml(s) {
      if (!s) return ''
      return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    },
    wrap(text, kw) {
      const safe = this.escapeHtml(text)
      if (!kw) return safe
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(escaped, 'gi')
      return safe.replace(re, m => `<em class="hl">${m}</em>`)
    },
    goDetail() {
      this.$router.push(`/guides/${this.guide.Id}`)
    },
    toggleFav() {
      const wasFav = this.isFav
      this.$store.commit('toggleFavorite', this.guide.Id)
      this.$message({
        message: wasFav ? '已取消收藏' : '已加入收藏',
        type: 'success',
        duration: 1200
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.guide-card {
  background: #fff;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.25s, box-shadow 0.25s;

  &:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-card-hover);
  }
}

.card-cover {
  position: relative;
  height: 168px;
  background-size: cover;
  background-position: center;
  background-color: #e8e4de;
}

.season-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  background: var(--season-gradient);
}

.fav-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}

.card-body {
  padding: 14px 16px 16px;
  // 固定标题与摘要高度，使同行卡片基线对齐，避免内容长短不一导致网格错位
  min-height: 170px;
  display: flex;
  flex-direction: column;
}

.card-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-summary {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-sub);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 38px;
  flex: 1;
}

.card-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-sub);
  margin-bottom: 8px;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
