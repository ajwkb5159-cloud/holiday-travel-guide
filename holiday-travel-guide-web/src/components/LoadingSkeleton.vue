<template>
  <div class="skeleton-wrap" :class="{rows: variant === 'rows'}">
    <template v-if="variant === 'grid'">
      <div v-for="n in count" :key="n" class="sk-card">
        <div class="sk-cover shimmer"></div>
        <div class="sk-body">
          <div class="sk-line w70 shimmer"></div>
          <div class="sk-line w100 shimmer"></div>
          <div class="sk-line w100 shimmer"></div>
          <div class="sk-line w40 shimmer"></div>
        </div>
      </div>
    </template>
    <template v-else-if="variant === 'detail'">
      <div class="sk-detail">
        <div class="sk-block hero shimmer"></div>
        <div class="sk-line w60 shimmer big"></div>
        <div class="sk-line w100 shimmer"></div>
        <div class="sk-line w100 shimmer"></div>
        <div class="sk-line w85 shimmer"></div>
        <div class="sk-line w100 shimmer"></div>
        <div class="sk-line w90 shimmer"></div>
      </div>
    </template>
  </div>
</template>

<script>
export default {
  name: 'LoadingSkeleton',
  props: {
    variant: { type: String, default: 'grid' }, // grid | detail
    count: { type: Number, default: 12 }
  }
}
</script>

<style lang="scss" scoped>
.skeleton-wrap {
  width: 100%;
}
.sk-card {
  background: #fff;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.sk-cover {
  height: 168px;
}
.sk-body {
  padding: 14px 16px 16px;
}
.sk-line {
  height: 12px;
  margin-bottom: 10px;
  border-radius: 6px;
  &:last-child { margin-bottom: 0; }
}
.sk-line.w40 { width: 40%; }
.sk-line.w60 { width: 60%; }
.sk-line.w70 { width: 70%; }
.sk-line.w85 { width: 85%; }
.sk-line.w100 { width: 100%; }
.sk-line.big { height: 22px; margin: 14px 0; }
.sk-block.hero { height: 260px; border-radius: var(--radius-card); margin-bottom: 20px; }
.sk-detail { background: #fff; border-radius: var(--radius-card); box-shadow: var(--shadow-card); padding: 22px; }

// shimmer 动画：左→右扫光
.shimmer {
  background: linear-gradient(90deg, #ece9e3 25%, #f6f3ee 37%, #ece9e3 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

// 网格骨架沿用全局布局
.skeleton-wrap:not(.rows) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
  @media (max-width: 768px) {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }
  @media (max-width: 480px) {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    .sk-cover { height: 130px; }
  }
  .rows & {
    display: block;
  }
}
</style>