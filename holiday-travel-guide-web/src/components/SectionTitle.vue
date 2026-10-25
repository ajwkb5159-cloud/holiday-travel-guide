<template>
  <div class="section-title">
    <div class="title-row">
      <span class="accent-bar"></span>
      <h2 class="title">{{ title }}</h2>
      <router-link v-if="link" :to="link" class="more">查看更多 →</router-link>
    </div>
    <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
  </div>
</template>

<script>
export default {
  name: 'SectionTitle',
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    link: { type: Object, default: null }
  }
}
</script>

<style lang="scss" scoped>
.section-title {
  margin-bottom: 16px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.accent-bar {
  width: 6px;
  height: 22px;
  border-radius: 3px;
  background: var(--season-gradient);
}

.title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
}

.more {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-sub);

  &:hover {
    color: var(--season-accent);
  }
}

.subtitle {
  margin: 4px 0 0 16px;
  font-size: 13px;
  color: var(--text-sub);
}
</style>
