<template>
  <div class="page-container" v-loading="loading">
    <section-title title="标签云" subtitle="点击标签查看相关攻略" />
    <div v-if="tags.length" class="tag-cloud">
      <span
        v-for="t in tags"
        :key="t.Tag"
        class="cloud-tag"
        :style="{ fontSize: fontOf(t.Count) + 'px' }"
        @click="$router.push({ path: '/guides', query: { keyword: t.Tag } })"
      >
        {{ t.Tag }}
        <sup>{{ t.Count }}</sup>
      </span>
    </div>
    <empty-state v-else-if="!loading" text="暂无标签数据" />
  </div>
</template>

<script>
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getTags } from '@/api/tag'

export default {
  name: 'TagView',
  components: { SectionTitle, EmptyState },
  data() {
    return {
      tags: [],
      loading: true
    }
  },
  created() {
    this.load()
  },
  methods: {
    fontOf(count) {
      const max = Math.max(...this.tags.map(t => t.Count), 1)
      return 13 + Math.round((count / max) * 17)
    },
    async load() {
      this.loading = true
      try {
        this.tags = await getTags()
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.tag-cloud {
  background: #fff;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 28px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: baseline;
}

.cloud-tag {
  cursor: pointer;
  color: var(--text-main);
  font-weight: 500;
  transition: color 0.15s;

  &:hover {
    color: var(--season-accent);
  }

  sup {
    font-size: 10px;
    color: var(--text-sub);
  }
}
</style>
