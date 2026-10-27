<template>
  <div class="page-container">
    <loading-skeleton v-if="loading" variant="detail" />
    <template v-else-if="guide">
      <div class="back-row">
        <el-button size="mini" plain icon="el-icon-back" @click="$router.back()">返回</el-button>
      </div>

      <div class="detail-hero" :style="{ backgroundImage: `url(${guide.CoverImage || ''}), var(--season-gradient)` }">
        <div class="hero-mask"></div>
        <div class="hero-content">
          <h1 class="detail-title">{{ guide.Title }}</h1>
          <div class="detail-meta">
            <span class="meta">📍 {{ guide.Destination }}</span>
            <span v-if="guide.Days" class="meta">🕐 {{ guide.Days }} 天</span>
            <span v-if="guide.Season" class="meta">🍂 {{ SEASON_LABELS[guide.Season] || guide.Season }}季</span>
            <span v-if="guide.HolidayName" class="meta">🎉 {{ guide.HolidayName }}</span>
            <span class="meta">👀 {{ guide.ViewCount }}</span>
          </div>
          <el-button class="fav-detail" :type="isFav ? 'warning' : 'primary'" round size="small" @click="toggleFav">
            {{ isFav ? '❤️ 已收藏' : '🤍 收藏' }}
          </el-button>
        </div>
        <a
          v-if="coverCredit"
          class="hero-credit"
          :href="coverCredit.sourcePage"
          target="_blank"
          rel="noopener noreferrer"
        >图：{{ coverCredit.artist }} / {{ coverCredit.license }}</a>
      </div>

      <div class="detail-body">
        <p class="detail-summary">{{ guide.Summary }}</p>

        <div v-if="tagList.length" class="detail-tags">
          <el-tag v-for="tag in tagList" :key="tag" effect="plain">{{ tag }}</el-tag>
        </div>

        <div class="detail-content" v-html="safeContent"></div>
      </div>

      <section v-if="guide.Related && guide.Related.length" class="related">
        <section-title title="相关攻略" />
        <div class="card-grid">
          <guide-card v-for="g in guide.Related.slice(0, 5)" :key="g.Id" :guide="g" />
        </div>
      </section>
    </template>
    <empty-state v-else text="攻略不存在或已下架" />
  </div>
</template>

<script>
import GuideCard from '@/components/GuideCard.vue'
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import { getGuideDetail } from '@/api/guide'
import { getImageCredit } from '@/api/imageCredits'
import { SEASON_LABELS } from '@/utils/season'
import { sanitizeGuideContent } from '@/utils/dom'
import { recordGuideView } from '@/utils/behavior'

export default {
  name: 'GuideDetailView',
  components: { GuideCard, SectionTitle, EmptyState, LoadingSkeleton },
  data() {
    return {
      SEASON_LABELS,
      guide: null,
      coverCredit: null,
      loading: true
    }
  },
  computed: {
    // 后端 content 是 HTML，先经 DOMPurify 清洗防 XSS，再 v-html 直染（钩子已给内嵌图加 lazy+onError 兜底）
    safeContent() {
      return this.guide ? sanitizeGuideContent(this.guide.Content) : ''
    },
    tagList() {
      if (!this.guide) return []
      if (this.guide.TagList && this.guide.TagList.length) return this.guide.TagList
      const tags = this.guide.Tags
      if (!tags) return []
      return Array.isArray(tags) ? tags : String(tags).split(',').filter(Boolean)
    },
    isFav() {
      return this.guide ? this.$store.getters.isFavorite(this.guide.Id) : false
    }
  },
  watch: {
    '$route.params.id': 'load'
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      this.guide = null
      this.coverCredit = null
      try {
        this.guide = await getGuideDetail(this.$route.params.id)
        // 行为埋点：供首页「猜你喜欢」个性化推荐（纯 localStorage，静默失败）
        if (this.guide) {
          recordGuideView(this.guide)
          this.loadCoverCredit()
        }
      } catch (e) {
        this.guide = null
      } finally {
        this.loading = false
      }
    },
    async loadCoverCredit() {
      try {
        this.coverCredit = await getImageCredit(this.guide && this.guide.CoverImage)
      } catch (e) {
        this.coverCredit = null
      }
    },
    toggleFav() {
      if (!this.guide) return
      const wasFav = this.isFav
      this.$store.commit('toggleFavorite', this.guide.Id)
      this.$message({ message: wasFav ? '已取消收藏' : '已加入收藏', type: 'success', duration: 1200 })
    }
  }
}
</script>

<style lang="scss" scoped>
.back-row {
  margin-bottom: 14px;
}

.detail-hero {
  position: relative;
  border-radius: var(--radius-card);
  overflow: hidden;
  background-size: cover;
  background-position: center;
  background-color: var(--text-main);
  min-height: 260px;
  display: flex;
  align-items: flex-end;
}

.hero-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.7) 100%);
}

.hero-content {
  position: relative;
  z-index: 1;
  padding: 26px 30px;
  color: #fff;
}

.hero-credit {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 2;
  max-width: 68%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 3px 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  text-decoration: none;

  &:hover {
    color: #fff;
    text-decoration: underline;
  }
}

.detail-title {
  margin: 0 0 12px;
  font-size: clamp(22px, 4.4vw, 30px);
  font-weight: 900;
  line-height: 1.2;
}

.detail-meta {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 14px;
  opacity: 0.95;
  margin-bottom: 14px;
}

.detail-body {
  background: #fff;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 26px 30px;
  margin-top: 20px;
  @media (max-width: 768px) {
    padding: 18px 18px;
  }
}

.detail-summary {
  font-size: 15px;
  color: var(--text-sub);
  line-height: 1.8;
  margin: 0 0 16px;
  padding-left: 12px;
  border-left: 4px solid var(--season-accent);
}

.detail-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.detail-content {
  font-size: 15px;
  line-height: 2;
  color: var(--text-main);

  ::v-deep p {
    margin: 0 0 14px;
  }

  ::v-deep img {
    max-width: 100%;
    border-radius: 12px;
  }

  ::v-deep h2 {
    font-size: 20px;
    font-weight: 800;
    margin: 30px 0 14px;
    padding-left: 12px;
    border-left: 4px solid var(--season-accent);
  }

  ::v-deep h3 {
    font-size: 17px;
    font-weight: 700;
    margin: 22px 0 10px;
  }

  ::v-deep ul,
  ::v-deep ol {
    padding-left: 22px;
    margin: 0 0 16px;
  }

  ::v-deep li {
    margin-bottom: 6px;
  }

  ::v-deep table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    margin: 12px 0 18px;
    font-size: 14px;
  }

  ::v-deep th {
    background: var(--bg);
    font-weight: 700;
  }

  ::v-deep th,
  ::v-deep td {
    border: 1px solid rgba(45, 42, 38, 0.1);
    padding: 8px 12px;
    text-align: left;
  }

  ::v-deep blockquote {
    margin: 14px 0;
    padding: 10px 16px;
    background: var(--bg);
    border-left: 4px solid var(--season-accent);
    border-radius: 8px;
    color: var(--text-sub);
  }

  ::v-deep a {
    color: var(--season-accent);
  }

  ::v-deep hr {
    border: none;
    border-top: 1px dashed rgba(45, 42, 38, 0.15);
    margin: 24px 0;
  }
}

.related {
  margin-top: 36px;
}
</style>
