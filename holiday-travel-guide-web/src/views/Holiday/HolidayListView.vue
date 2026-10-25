<template>
  <div class="page-container" v-loading="loading">
    <section-title title="节假日专题" subtitle="点击节日查看对应攻略" />
    <div v-if="holidays.length" class="holiday-grid">
      <div
        v-for="h in holidays"
        :key="h.Name"
        class="holiday-card"
        @click="$router.push({ path: '/guides', query: { holidayName: h.Name } })"
      >
        <div class="holiday-date">{{ h.Date }}</div>
        <div class="holiday-name">{{ h.Name }}</div>
        <div class="holiday-type">
          <el-tag size="mini" :type="h.IsLegal === 1 ? 'danger' : 'info'" effect="plain">
            {{ h.IsLegal === 1 ? '法定节假日' : typeLabel(h.Type) }}
          </el-tag>
        </div>
        <p class="holiday-desc">{{ h.Description }}</p>
        <div class="holiday-cd">{{ countdownText(h.Date) }}</div>
      </div>
    </div>
    <empty-state v-else-if="!loading" text="暂无节日数据" />
  </div>
</template>

<script>
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getHolidays } from '@/api/holiday'
import { countdownText } from '@/utils/format'

export default {
  name: 'HolidayListView',
  components: { SectionTitle, EmptyState },
  data() {
    return {
      holidays: [],
      loading: true
    }
  },
  created() {
    this.load()
  },
  methods: {
    countdownText,
    typeLabel(type) {
      return { traditional: '传统节日', legal: '法定节日', custom: '专题节日' }[type] || type || '节日'
    },
    async load() {
      this.loading = true
      try {
        this.holidays = await getHolidays()
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.holiday-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
}

.holiday-card {
  background: #fff;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 20px;
  cursor: pointer;
  transition: transform 0.25s, box-shadow 0.25s;

  &:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-card-hover);
  }
}

.holiday-date {
  font-size: 12px;
  color: var(--text-sub);
}

.holiday-name {
  font-size: 20px;
  font-weight: 800;
  margin: 4px 0 8px;
}

.holiday-type {
  margin-bottom: 10px;
}

.holiday-desc {
  font-size: 13px;
  color: var(--text-sub);
  line-height: 1.7;
  margin: 0 0 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 44px;
}

.holiday-cd {
  font-size: 14px;
  font-weight: 600;
  color: var(--season-accent);
}
</style>
