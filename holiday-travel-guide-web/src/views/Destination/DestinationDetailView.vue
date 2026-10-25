<template>
  <div class="page-container" v-loading="loading">
    <template v-if="detail">
      <div class="back-row">
        <el-button size="mini" plain icon="el-icon-back" @click="$router.back()">返回</el-button>
      </div>

      <div class="dest-hero">
        <div class="dest-title">{{ detail.Name }}</div>
        <div class="dest-meta">{{ detail.Region }} · 共 {{ detail.GuideCount }} 篇攻略</div>
      </div>

      <section class="section">
        <section-title title="相关攻略" />
        <div v-if="detail.Guides && detail.Guides.length" class="card-grid">
          <guide-card v-for="g in detail.Guides.slice(0, 20)" :key="g.Id" :guide="g" />
        </div>
        <empty-state v-else text="这个目的地暂时没有攻略" />
      </section>
    </template>
    <empty-state v-else-if="!loading" text="目的地不存在" />
  </div>
</template>

<script>
import GuideCard from '@/components/GuideCard.vue'
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getDestinationDetail } from '@/api/destination'

export default {
  name: 'DestinationDetailView',
  components: { GuideCard, SectionTitle, EmptyState },
  data() {
    return {
      detail: null,
      loading: true
    }
  },
  watch: {
    '$route.params.name': 'load'
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      this.detail = null
      try {
        this.detail = await getDestinationDetail(this.$route.params.name)
      } catch (e) {
        this.detail = null
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.back-row {
  margin-bottom: 14px;
}

.dest-hero {
  background: var(--season-gradient);
  color: #fff;
  border-radius: var(--radius-card);
  padding: 40px 32px;
  margin-bottom: 28px;
}

.dest-title {
  font-size: 32px;
  font-weight: 900;
  margin-bottom: 6px;
}

.dest-meta {
  font-size: 14px;
  opacity: 0.92;
}
</style>
