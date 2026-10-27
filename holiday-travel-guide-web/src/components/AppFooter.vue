<template>
  <footer class="app-footer">
    <p>节假日旅游攻略 · 数据仅供参考，出行前请确认官方信息</p>
    <p v-if="publishTime" class="sub" :class="{ stale }">
      {{ publishTime }}<span v-if="stale"> · 数据可能已过期</span>
    </p>
    <p class="sub"><router-link to="/image-credits">图片来源与许可</router-link></p>
    <p class="sub">© {{ year }} Holiday Travel Guide</p>
  </footer>
</template>

<script>
import { getSystemStatus } from '@/api/system'

export default {
  name: 'AppFooter',
  data() {
    return { publishTime: '', stale: false }
  },
  computed: {
    year() {
      return new Date().getFullYear()
    }
  },
  mounted() {
    this.loadPublishTime()
  },
  methods: {
    async loadPublishTime() {
      try {
        const st = await getSystemStatus()
        if (st && st.LastPublishTime) {
          this.publishTime = '攻略数据更新于 ' + st.LastPublishTime + ' · 共 ' + st.GuideCount + ' 篇'
          this.stale = !!st.IsStale
        }
      } catch (e) {
        /* 展示失败静默，不影响页脚 */
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.app-footer {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-sub);
  font-size: 13px;
  border-top: 1px solid rgba(45, 42, 38, 0.06);
  background: #fff;

  p {
    margin: 4px 0;
  }

  .sub {
    font-size: 12px;
  }

  a {
    color: inherit;
    text-decoration: none;

    &:hover {
      color: var(--season-accent);
    }
  }

  .stale {
    color: #c2410c;
  }
}
</style>
