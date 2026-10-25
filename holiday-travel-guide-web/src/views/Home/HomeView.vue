<template>
  <div class="home">
    <!-- Hero：季节渐变横幅 + 最近节日 + 随机抽目的地 -->
    <section class="hero">
      <div class="hero-inner">
        <h1 class="hero-title">节假日去哪儿玩？</h1>
        <p class="hero-sub">最全节假日出行攻略 · 跟着季节去旅行</p>
        <div class="hero-actions">
          <button class="random-btn" :disabled="rolling" @click="rollDestination">
            {{ rolling ? rollingName || '🎲' : '🎲 今天去哪' }}
          </button>
          <router-link v-if="nearest" :to="{ path: '/holidays' }" class="hero-countdown">
            距 {{ nearest.Name }} 还有 <b>{{ nearest.DaysLeft }}</b> 天
          </router-link>
        </div>
      </div>
    </section>

    <div class="page-container">
      <!-- 节假日倒计时横条 -->
      <section v-if="home.Countdowns && home.Countdowns.length" class="section">
        <section-title title="节假日倒计时" subtitle="提前规划，玩得更从容" :link="{ path: '/holidays' }" />
        <div class="countdown-strip">
          <holiday-countdown v-for="h in home.Countdowns.slice(0, 4)" :key="h.Name" :holiday="h" />
        </div>
      </section>

      <!-- 当季推荐 -->
      <section class="section">
        <section-title title="当季推荐" :subtitle="seasonSubtitle" :link="{ path: '/guides' }" />
        <loading-skeleton v-if="loading" :count="6" />
        <template v-else>
          <div v-if="home.Seasonal && home.Seasonal.length" class="card-grid">
            <guide-card v-for="g in home.Seasonal.slice(0, 6)" :key="g.Id" :guide="g" />
          </div>
          <empty-state v-else text="当季推荐整理中，先去别处逛逛吧" />
        </template>
      </section>

      <!-- 猜你喜欢：基于浏览/收藏行为的个性化推荐（无行为数据时整块隐藏，热门榜兜底） -->
      <section v-if="recommend.length" class="section">
        <section-title title="猜你喜欢" subtitle="根据你的浏览与收藏偏好定制" />
        <div class="card-grid">
          <guide-card v-for="g in recommend.slice(0, 6)" :key="'r-' + g.Id" :guide="g" />
        </div>
      </section>

      <!-- 临近节日攻略：取最近一个节日的高浏览攻略（消费后端 HomeAggregateDto.NearestGuides） -->
      <section v-if="!loading && home.NearestGuides && home.NearestGuides.length" class="section">
        <section-title title="临近节日攻略" :subtitle="nearestGuideSubtitle" :link="{ path: '/guides' }" />
        <div class="card-grid">
          <guide-card v-for="g in home.NearestGuides.slice(0, 6)" :key="g.Id" :guide="g" />
        </div>
      </section>

      <!-- 热门攻略 + 热门目的地 Bento -->
      <section class="section bento">
        <div class="bento-left">
          <section-title title="热门攻略" :link="{ path: '/guides' }" />
          <loading-skeleton v-if="loading" :count="6" />
          <template v-else>
            <div v-if="home.Hot && home.Hot.length" class="hot-list">
              <div v-for="(g, i) in home.Hot.slice(0, 8)" :key="g.Id" class="hot-item" @click="$router.push(`/guides/${g.Id}`)">
                <span class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
                <div class="hot-info">
                  <div class="hot-title">{{ g.Title }}</div>
                  <div class="hot-meta">📍 {{ g.Destination }} · 👀 {{ g.ViewCount }}</div>
                </div>
                <span v-if="g.HolidayName" class="hot-holiday">{{ g.HolidayName }}</span>
              </div>
            </div>
            <empty-state v-else />
          </template>
        </div>
        <div class="bento-right">
          <section-title title="热门目的地" :link="{ path: '/destinations' }" />
          <loading-skeleton v-if="loading" :count="4" />
          <template v-else>
            <div v-if="home.HotDestinations && home.HotDestinations.length" class="dest-grid">
              <div
                v-for="d in home.HotDestinations.slice(0, 8)"
                :key="d.Name"
                class="dest-chip"
                :style="{ backgroundImage: `url(${d.CoverImage || ''}), var(--season-gradient)` }"
                @click="$router.push(`/destinations/${encodeURIComponent(d.Name)}`)"
              >
                <div class="dest-name">{{ d.Name }}</div>
                <div class="dest-meta">{{ d.Region }} · {{ d.GuideCount }} 篇攻略</div>
              </div>
            </div>
            <empty-state v-else />
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
import GuideCard from '@/components/GuideCard.vue'
import HolidayCountdown from '@/components/HolidayCountdown.vue'
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import { getHome, getRecommend } from '@/api/guide'
import { seasonOfMonth, SEASON_LABELS } from '@/utils/season'
import { hasBehaviorSignals, getBehaviorSignals } from '@/utils/behavior'

export default {
  name: 'HomeView',
  components: { GuideCard, HolidayCountdown, SectionTitle, EmptyState, LoadingSkeleton },
  data() {
    return {
      home: {},
      loading: true,
      rolling: false,
      rollingName: '',
      recommend: []
    }
  },
  computed: {
    nearest() {
      return (this.home.Countdowns || []).find(h => h.DaysLeft >= 0) || null
    },
    nearestGuideSubtitle() {
      const n = this.nearest
      if (!n) return '精选高浏览攻略'
      return n.DaysLeft > 0 ? `距${n.Name}还有 ${n.DaysLeft} 天，抢先规划` : `${n.Name}就在今天`
    },
    seasonSubtitle() {
      const s = seasonOfMonth()
      return `适合${SEASON_LABELS[s]}季出发的目的地`
    }
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      try {
        this.home = await getHome()
      } finally {
        this.loading = false
      }
      this.loadRecommend()
    },
    // 推荐不阻塞首页主体渲染；失败静默（模块不出现即降级）
    async loadRecommend() {
      try {
        const favIds = this.$store.getters.favoriteIds || []
        if (!hasBehaviorSignals(favIds)) return
        const s = getBehaviorSignals(favIds)
        this.recommend = await getRecommend({
          destinations: s.destinations,
          categories: s.categories,
          tags: s.tags,
          excludeIds: s.excludeIds.slice(0, 30),
          limit: 6
        })
      } catch (e) {
        this.recommend = []
      }
    },
    rollDestination() {
      const dests = this.home.HotDestinations || []
      if (!dests.length || this.rolling) return
      this.rolling = true
      let tick = 0
      const timer = setInterval(() => {
        this.rollingName = dests[Math.floor(Math.random() * dests.length)].Name
        tick++
        if (tick >= 8) {
          clearInterval(timer)
          this.rolling = false
          this.$message.success(`就决定是你了：${this.rollingName}！`)
          this.$router.push(`/destinations/${encodeURIComponent(this.rollingName)}`)
        }
      }, 120)
    }
  }
}
</script>

<style lang="scss" scoped>
.hero {
  background: var(--season-gradient);
  color: #fff;
}

.hero-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 56px 16px 48px;
}

.hero-title {
  margin: 0 0 8px;
  font-size: clamp(26px, 5vw, 36px);
  font-weight: 900;
  letter-spacing: 2px;
}

.hero-sub {
  margin: 0 0 24px;
  font-size: clamp(14px, 2vw, 16px);
  opacity: 0.92;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  // 窄屏：随机按钮与倒计时并排会挤，各自成一排更稳
  @media (max-width: 480px) {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
}

.random-btn {
  border: none;
  padding: 12px 26px;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 700;
  color: var(--primary);
  background: #fff;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.05);
  }

  &:disabled {
    opacity: 0.8;
  }
}

.hero-countdown {
  font-size: 15px;

  b {
    font-size: 20px;
  }
}

.section {
  margin-bottom: 40px;
}

.countdown-strip {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.bento {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 28px;
}

.hot-list {
  background: #fff;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 8px 0;
}

.hot-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: rgba(45, 42, 38, 0.04);
  }
}

.rank {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-sub);
  background: var(--bg);
  flex-shrink: 0;

  &.top {
    color: #fff;
    background: var(--season-gradient);
  }
}

.hot-info {
  flex: 1;
  min-width: 0;
}

.hot-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hot-meta {
  font-size: 12px;
  color: var(--text-sub);
}

.hot-holiday {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--season-accent);
}

.dest-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.dest-chip {
  position: relative;
  background: #fff;
  background-size: cover;
  background-position: center;
  background-color: var(--text-main);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 16px;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.55) 100%);
  }

  &:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-card-hover);
  }
}

.dest-name {
  position: relative;
  z-index: 1;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
  color: #fff;
}

.dest-meta {
  position: relative;
  z-index: 1;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
}

@media (max-width: 900px) {
  .bento {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .hero-inner {
    padding: 36px 16px 32px;
  }
  .section {
    margin-bottom: 28px;
  }
  .countdown-strip {
    gap: 10px;
  }
}

@media (max-width: 480px) {
  .hot-item {
    padding: 9px 14px;
  }
  .hot-holiday {
    display: none; // 小屏隐藏节日 tag，给标题让位
  }
  .dest-grid {
    grid-template-columns: 1fr;
  }
}
</style>
