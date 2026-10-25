<template>
  <div v-if="visible" class="maintenance-overlay">
    <div class="busy-card">
      <div class="busy-icon">🛠️</div>
      <h2 class="busy-title">服务器繁忙，请稍后重试</h2>
      <p class="busy-sub">系统正在更新攻略数据，请稍候…</p>
      <p v-if="countdown > 0" class="busy-count">自动重试倒计时 {{ countdown }} 秒</p>
      <el-button type="primary" round size="medium" @click="pollNow">立即重试</el-button>
    </div>
  </div>
</template>

<script>
import { getSystemStatus } from '@/api/system'

// 全屏「服务器繁忙」遮罩：轮询 /api/system/status，updating/maintenance 时展示；
// 恢复 normal 后自动整页刷新（拉取更新后的新数据）。接口失败不误报，维持当前状态。
export default {
  name: 'MaintenanceOverlay',
  data() {
    return {
      visible: false,
      countdown: 0,
      pollTimer: null,
      tickTimer: null,
      wasBusy: false
    }
  },
  mounted() {
    document.addEventListener('visibilitychange', this.onVisibility)
    this.pollNow() // 进入页面立即探测，更新期间不用等一个轮询周期
  },
  beforeDestroy() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.clearTimers()
  },
  methods: {
    onVisibility() {
      if (!document.hidden) this.pollNow() // 回到前台立即重试
      else this.clearTimers() // 后台暂停轮询省资源
    },
    clearTimers() {
      if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null }
      if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }
    },
    schedule() {
      this.clearTimers()
      const intervalMs = this.visible ? 5000 : 30000
      this.countdown = Math.round(intervalMs / 1000)
      this.tickTimer = setInterval(() => { if (this.countdown > 0) this.countdown-- }, 1000)
      this.pollTimer = setTimeout(() => this.pollNow(), intervalMs)
    },
    async pollNow() {
      this.clearTimers()
      let mode = null
      try {
        const st = await getSystemStatus()
        mode = st && st.Mode ? st.Mode : 'normal'
      } catch (e) {
        mode = null
      }
      if (mode === 'updating' || mode === 'maintenance') {
        this.wasBusy = true
        this.visible = true
      } else if (this.visible && this.wasBusy) {
        this.visible = false
        this.wasBusy = false
        window.location.reload() // 更新完成：整页刷新加载新数据（仅 busy→normal 过渡触发一次）
        return
      } else {
        this.wasBusy = false
        this.visible = false
      }
      this.schedule()
    }
  }
}
</script>

<style lang="scss" scoped>
.maintenance-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff; /* 纯白不透明：避免半透明+模糊让背后内容像渲染残影 */
  backdrop-filter: blur(2px);
}

.busy-card {
  text-align: center;
  padding: 40px 48px;
  max-width: 420px;
}

.busy-icon {
  font-size: 72px;
  line-height: 1;
  margin-bottom: 18px;
  animation: busy-breathe 2s ease-in-out infinite;
}

@keyframes busy-breathe {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.75; }
}

.busy-title {
  margin: 0 0 10px;
  font-size: 22px;
  color: var(--text-main);
}

.busy-sub {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text-sub);
}

.busy-count {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-sub);
}

@media (max-width: 480px) {
  .busy-card { padding: 32px 20px; }
  .busy-icon { font-size: 56px; }
  .busy-title { font-size: 18px; }
}
</style>
