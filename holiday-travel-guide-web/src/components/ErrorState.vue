<template>
  <div class="error-state">
    <div class="err-emoji">😵</div>
    <p class="err-text">{{ text }}</p>
    <el-button v-if="showRetry" type="primary" size="small" icon="el-icon-refresh" @click="$emit('retry')">
      {{ retryText }}
    </el-button>
  </div>
</template>

<script>
export default {
  name: 'ErrorState',
  props: {
    text: { type: String, default: '加载失败，请重试' },
    showRetry: { type: Boolean, default: true },
    retryText: { type: String, default: '重试' }
  }
}
</script>

<style lang="scss" scoped>
.error-state {
  text-align: center;
  padding: 48px 16px;
  color: var(--text-sub);
}
.err-emoji {
  font-size: 80px;
  line-height: 1;
  margin-bottom: 20px;
}
.err-text {
  margin: 0 0 8px;
  font-size: 20px;
  color: var(--text-main);
}
@media (max-width: 480px) {
  .error-state { padding: 36px 12px; }
  .err-emoji { font-size: 64px; margin-bottom: 14px; }
  .err-text { font-size: 16px; }
}
</style>