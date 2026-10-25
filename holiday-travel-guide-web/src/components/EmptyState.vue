<template>
  <div class="empty-state">
    <div class="empty-icon">🗺️</div>
    <p class="empty-text">{{ text }}</p>
  </div>
</template>

<script>
export default {
  name: 'EmptyState',
  props: {
    text: { type: String, default: '暂无数据' }
  }
}
</script>

<style lang="scss" scoped>
.empty-state {
  padding: 48px 16px;
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 8px;
}

.empty-text {
  margin: 0;
  color: var(--text-sub);
  font-size: 14px;
}
</style>
