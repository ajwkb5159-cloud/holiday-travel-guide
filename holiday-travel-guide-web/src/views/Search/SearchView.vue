<template>
  <div class="page-container">
    <section-title title="搜索" subtitle="搜攻略、搜目的地，一次到位" />
    <div class="search-bar">
      <el-autocomplete
        v-model="keyword"
        :fetch-suggestions="fetchSuggest"
        placeholder="输入关键词，如：杭州 / 火锅 / 国庆"
        class="search-input"
        @select="runSearch"
        @focus="onFocus"
        @blur="onBlur"
      >
        <template slot-scope="{ item }">
          <span>{{ item.value }}</span>
        </template>
        <el-button slot="append" type="primary" icon="el-icon-search" @click="runSearch">搜索</el-button>
      </el-autocomplete>

      <!-- 搜索历史：输入框聚焦且为空时下方展示历史 chip -->
      <div v-if="showHistory && history.length" class="history-row">
        <span class="history-label">最近搜索</span>
        <div class="history-chips">
          <button
            v-for="h in history"
            :key="h"
            class="history-chip"
            @click="pickHistory(h)"
          >{{ h }}</button>
        </div>
        <button class="history-clear" @click="clearHistory">清除</button>
      </div>
    </div>

    <!-- 热门搜索：无历史或刚进入时给点引导 -->
    <div v-if="!searched && !results.length" class="hot-row">
      <span class="hot-label">大家在搜</span>
      <button v-for="t in hotTags" :key="t" class="hot-chip" @click="pickHistory(t)">{{ t }}</button>
    </div>

    <loading-skeleton v-if="loading" :count="6" />
    <template v-else>
      <div v-if="results.length" class="card-grid">
        <guide-card v-for="g in results" :key="g.Id" :guide="g" :highlight="activeKeyword" />
      </div>
      <empty-state v-else-if="searched" :text="`没有找到与「${activeKeyword}」相关的内容`" />
      <empty-state v-else text="输入关键词开始搜索" />
    </template>
  </div>
</template>

<script>
import GuideCard from '@/components/GuideCard.vue'
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import { searchGuides, suggest } from '@/api/search'
import { getSearchHistory, addSearchHistory, clearSearchHistory } from '@/utils/search-history'

export default {
  name: 'SearchView',
  components: { GuideCard, SectionTitle, EmptyState, LoadingSkeleton },
  data() {
    return {
      keyword: '',
      activeKeyword: '',
      results: [],
      loading: false,
      searched: false,
      focused: false,
      history: getSearchHistory(),
      hotTags: ['北京', '故宫', '美食', '国庆', '七夕', '成都']
    }
  },
  computed: {
    showHistory() {
      return this.focused && !this.keyword.trim()
    }
  },
  watch: {
    '$route.query.q': {
      immediate: true,
      handler(q) {
        if (q != null) {
          this.keyword = String(q)
          this.runSearch()
        }
      }
    }
  },
  methods: {
    onFocus() { this.focused = true },
    onBlur() { setTimeout(() => { this.focused = false }, 150) },
    pickHistory(kw) {
      this.keyword = kw
      this.runSearch()
    },
    clearHistory() {
      clearSearchHistory()
      this.history = []
    },
    async fetchSuggest(text, cb) {
      if (!text || !text.trim()) return cb([])
      try {
        const list = await suggest(text.trim())
        cb((list || []).map(v => ({ value: v })))
      } catch (e) {
        cb([])
      }
    },
    async runSearch() {
      const q = this.keyword.trim()
      if (!q) return
      // URL 同步：刷新/分享可复现关键字
      if (this.$route.query.q !== q) {
        this.$router.replace({ query: { q } }).catch(() => {})
      }
      addSearchHistory(q)
      this.history = getSearchHistory()
      this.loading = true
      this.searched = true
      try {
        this.results = await searchGuides(q)
        this.activeKeyword = q
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.search-bar {
  background: #fff;
  padding: 20px;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  margin-bottom: 24px;
}

.search-input {
  width: 100%;
  max-width: 620px;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.history-label {
  font-size: 13px;
  color: var(--text-sub);
}
.history-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}
.history-chip {
  border: 1px solid rgba(45, 42, 38, 0.12);
  background: var(--bg);
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-main);
  &:hover { color: var(--primary); border-color: var(--primary); }
}
.history-clear {
  border: none;
  background: none;
  color: var(--text-sub);
  font-size: 12px;
  cursor: pointer;
  &:hover { color: var(--primary); }
}

.hot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.hot-label { font-size: 13px; color: var(--text-sub); }
.hot-chip {
  border: 1px solid var(--season-accent);
  background: #fff;
  color: var(--season-accent);
  border-radius: 999px;
  padding: 5px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: var(--season-accent); color: #fff; }
}
</style>