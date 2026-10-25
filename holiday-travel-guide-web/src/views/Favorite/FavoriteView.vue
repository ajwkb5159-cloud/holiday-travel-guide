<template>
  <div class="page-container">
    <section-title :title="`我的收藏 · ${guides.length} 篇`" subtitle="收藏的攻略都在这里" />
    <loading-skeleton v-if="loading" />
    <template v-else>
      <div v-if="guides.length" class="card-grid">
        <guide-card v-for="g in guides" :key="g.Id" :guide="g" />
      </div>
      <div v-else class="empty-wrap">
        <empty-state text="还没有收藏任何攻略" />
        <el-button type="primary" round @click="$router.push('/guides')">去发现攻略</el-button>
      </div>
    </template>
  </div>
</template>

<script>
import GuideCard from '@/components/GuideCard.vue'
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import { getGuideDetail } from '@/api/guide'

export default {
  name: 'FavoriteView',
  components: { GuideCard, SectionTitle, EmptyState, LoadingSkeleton },
  data() {
    return {
      guides: [],
      loading: true
    }
  },
  watch: {
    '$store.state.favorites': 'load'
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      // favorites 是 [{id, addedAt}]，按收藏时间降序（最近收藏在前）
      const favs = [...this.$store.state.favorites].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      if (!favs.length) {
        this.guides = []
        this.loading = false
        return
      }
      // 批量并发拉详情，逐条请求但 allSettled 容错；量级小(本地收藏)可接受
      this.loading = true
      const settled = await Promise.allSettled(favs.map(f => getGuideDetail(f.id)))
      const detailMap = new Map()
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) detailMap.set(favs[i].id, r.value)
      })
      // 按收藏时间顺序排回结果（allSettled 完成顺序不确定）
      this.guides = favs.map(f => detailMap.get(f.id)).filter(Boolean)
      this.loading = false
    }
  }
}
</script>

<style lang="scss" scoped>
.empty-wrap {
  text-align: center;
  padding: 32px 16px;
  :deep(.empty-state) { padding-bottom: 36px; }
}
</style>