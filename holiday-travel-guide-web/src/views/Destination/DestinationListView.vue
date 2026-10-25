<template>
  <div class="page-container" v-loading="loading">
    <section-title title="目的地" subtitle="按地区与季节发现旅行灵感" />
    <div class="filter-bar">
      <el-select v-model="region" placeholder="地区" clearable class="filter-select" @change="load">
        <el-option v-for="r in regions" :key="r" :label="r" :value="r" />
      </el-select>
      <el-select v-model="season" placeholder="季节" clearable class="filter-select" @change="load">
        <el-option v-for="(label, key) in SEASON_LABELS" :key="key" :label="`${label}季`" :value="key" />
      </el-select>
    </div>

    <div v-if="dests.length" class="dest-grid">
      <div
        v-for="d in dests"
        :key="d.Name"
        class="dest-card"
        :style="{ backgroundImage: `url(${d.CoverImage || ''}), var(--season-gradient)` }"
        @click="$router.push(`/destinations/${encodeURIComponent(d.Name)}`)"
      >
        <div class="dest-mask"></div>
        <div class="dest-info">
          <div class="dest-name">{{ d.Name }}</div>
          <div class="dest-meta">{{ d.Region }} · {{ d.GuideCount }} 篇攻略</div>
        </div>
      </div>
    </div>
    <empty-state v-else-if="!loading" text="没有找到符合条件的目的地" />
  </div>
</template>

<script>
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getDestinations } from '@/api/destination'
import { SEASON_LABELS } from '@/utils/season'

export default {
  name: 'DestinationListView',
  components: { SectionTitle, EmptyState },
  data() {
    return {
      SEASON_LABELS,
      dests: [],
      region: '',
      season: '',
      loading: true
    }
  },
  computed: {
    regions() {
      return [...new Set(this.dests.map(d => d.Region).filter(Boolean))]
    }
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      try {
        // region/season 过滤由后端执行
        const params = { limit: 200 }
        if (this.region) params.region = this.region
        if (this.season) params.season = this.season
        this.dests = await getDestinations(params)
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.filter-select {
  width: 150px;
}

.dest-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 18px;
}

.dest-card {
  position: relative;
  height: 160px;
  border-radius: var(--radius-card);
  overflow: hidden;
  background-size: cover;
  background-position: center;
  background-color: var(--text-main);
  cursor: pointer;
  box-shadow: var(--shadow-card);
  transition: transform 0.25s, box-shadow 0.25s;

  &:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-card-hover);
  }
}

.dest-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.6) 100%);
}

.dest-info {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 12px;
  color: #fff;
}

.dest-name {
  font-size: 20px;
  font-weight: 800;
  margin-bottom: 2px;
}

.dest-meta {
  font-size: 12px;
  opacity: 0.9;
}
</style>
