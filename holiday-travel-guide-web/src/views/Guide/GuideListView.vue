<template>
  <div class="page-container">
    <section-title title="全部攻略" :subtitle="`共 ${total} 篇 · 按需筛选`" />
    <div class="filter-bar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索攻略标题 / 标签"
        class="filter-input"
        clearable
        @keyup.enter.native="applyQuery"
        @clear="applyQuery"
      >
        <i slot="prefix" class="el-icon-search"></i>
      </el-input>
      <el-select v-model="query.season" placeholder="季节" clearable class="filter-select" @change="applyQuery">
        <el-option v-for="(label, key) in SEASON_LABELS" :key="key" :label="`${label}季`" :value="key" />
      </el-select>
      <el-select v-model="query.destination" placeholder="目的地" clearable filterable class="filter-select" @change="applyQuery">
        <el-option v-for="d in destOptions" :key="d.Name" :label="d.Name" :value="d.Name" />
      </el-select>
      <sort-select v-model="query.sort" @change="applyQuery" />
      <el-button type="primary" @click="applyQuery">查询</el-button>
    </div>

    <loading-skeleton v-if="loading" />
    <template v-else>
      <div v-if="items.length" class="card-grid">
        <guide-card v-for="g in items" :key="g.Id" :guide="g" :highlight="query.keyword" />
      </div>
      <empty-state v-else text="没有找到符合条件的攻略" />
      <div v-if="total > size" class="pager-wrap">
        <el-pagination
          :current-page.sync="page"
          :page-size="size"
          :total="total"
          :pager-count="5"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>
    </template>
  </div>
</template>

<script>
import GuideCard from '@/components/GuideCard.vue'
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import SortSelect from '@/components/SortSelect.vue'
import { getGuides } from '@/api/guide'
import { getDestinations } from '@/api/destination'
import { SEASON_LABELS } from '@/utils/season'

export default {
  name: 'GuideListView',
  components: { GuideCard, SectionTitle, EmptyState, LoadingSkeleton, SortSelect },
  data() {
    return {
      SEASON_LABELS,
      items: [],
      total: 0,
      page: 1,
      size: 12,
      loading: false,
      query: { keyword: '', season: '', destination: '', sort: 'views' },
      holidayName: '',
      destOptions: []
    }
  },
  watch: {
    $route: {
      immediate: true,
      handler() {
        this.syncFromRoute()
        this.load()
      }
    }
  },
  created() {
    this.loadDestOptions()
  },
  methods: {
    syncFromRoute() {
      const q = this.$route.query
      this.query = {
        keyword: q.keyword || '',
        season: q.season || '',
        destination: q.destination || '',
        sort: q.sort || 'views'
      }
      if (q.holidayName) this.holidayName = q.holidayName
      this.page = 1
    },
    async loadDestOptions() {
      try {
        this.destOptions = await getDestinations({ limit: 200 })
      } catch (e) {
        /* 筛选下拉失败不阻塞列表 */
      }
    },
    async load() {
      this.loading = true
      try {
        const params = { page: this.page, size: this.size, sort: this.query.sort }
        if (this.query.keyword) params.keyword = this.query.keyword
        if (this.query.season) params.season = this.query.season
        if (this.query.destination) params.destination = this.query.destination
        if (this.holidayName) params.holidayName = this.holidayName
        const data = await getGuides(params)
        this.items = data.Items || []
        this.total = data.Total || 0
      } finally {
        this.loading = false
      }
    },
    applyQuery() {
      this.page = 1
      const q = {}
      if (this.query.keyword) q.keyword = this.query.keyword
      if (this.query.season) q.season = this.query.season
      if (this.query.destination) q.destination = this.query.destination
      if (this.query.sort && this.query.sort !== 'views') q.sort = this.query.sort
      if (this.holidayName) q.holidayName = this.holidayName
      this.$router.replace({ query: q }).catch(() => {})
      this.load()
    }
  }
}
</script>

<style lang="scss" scoped>
.filter-input {
  flex: 1;
  min-width: 220px;
}

.filter-select {
  width: 150px;
}

.pager-wrap {
  display: flex;
  justify-content: center;
  padding: 24px 0;
  overflow-x: auto;

  :deep(.el-pagination) {
    white-space: nowrap;
  }
}

@media (max-width: 640px) {
  .pager-wrap {
    justify-content: flex-start;

    :deep(.el-pagination__total) {
      display: none;
    }
  }
}
</style>
