<template>
  <header class="app-header">
    <div class="header-inner">
      <router-link to="/" class="brand">
        <span class="brand-icon">🏖️</span>
        <span class="brand-text">节假日旅游攻略</span>
      </router-link>
      <nav class="nav">
        <router-link
          v-for="item in navs"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
        >
          {{ item.label }}
        </router-link>
      </nav>
      <div class="header-search">
        <el-input
          v-model="keyword"
          placeholder="搜索目的地 / 攻略"
          size="small"
          @keyup.enter.native="goSearch"
        >
          <i slot="prefix" class="el-icon-search"></i>
        </el-input>
      </div>
    </div>
  </header>
</template>

<script>
export default {
  name: 'AppHeader',
  data() {
    return {
      keyword: '',
      navs: [
        { path: '/', label: '首页' },
        { path: '/guides', label: '攻略' },
        { path: '/destinations', label: '目的地' },
        { path: '/holidays', label: '节假日' },
        { path: '/tags', label: '标签云' },
        { path: '/favorites', label: '收藏' }
      ]
    }
  },
  methods: {
    isActive(path) {
      if (path === '/') return this.$route.path === '/'
      return this.$route.path.startsWith(path)
    },
    goSearch() {
      const q = this.keyword.trim()
      if (!q) return
      this.$router.push({ path: '/search', query: { q } })
    }
  }
}
</script>

<style lang="scss" scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(45, 42, 38, 0.06);
}

.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px;
  height: 60px;
  display: flex;
  align-items: center;
  gap: 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.brand-icon {
  font-size: 24px;
}

.brand-text {
  font-size: 18px;
  font-weight: 700;
  background: var(--season-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.nav {
  display: flex;
  gap: 4px;
  flex: 1;
}

.nav-item {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 14px;
  color: var(--text-main);
  transition: all 0.2s;

  &:hover {
    background: rgba(45, 42, 38, 0.05);
  }

  &.active {
    color: #fff;
    background: var(--season-gradient);
    font-weight: 600;
  }
}

.header-search {
  width: 220px;
}

@media (max-width: 900px) {
  .header-search {
    display: none;
  }
}

@media (max-width: 640px) {
  .header-inner {
    flex-wrap: wrap;
    height: auto;
    padding: 8px 16px;
    gap: 8px 16px;
  }

  .nav {
    order: 3;
    flex: 1 0 100%;
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .nav-item {
    flex: 0 0 auto;
    white-space: nowrap;
    padding: 6px 10px;
  }
}
</style>
