<template>
  <transition name="fade-up">
    <button v-show="visible" class="scroll-top" title="回到顶部" @click="scrollTop">↑</button>
  </transition>
</template>

<script>
export default {
  name: 'ScrollTopButton',
  data() {
    return { visible: false }
  },
  mounted() {
    // 监听 window 滚动（router scrollBehavior 已使切路由回顶，这里管的是页面内长滚动）
    window.addEventListener('scroll', this.onScroll, { passive: true })
    this.onScroll()
  },
  beforeDestroy() {
    window.removeEventListener('scroll', this.onScroll)
  },
  methods: {
    onScroll() {
      this.visible = (window.pageYOffset || document.documentElement.scrollTop) > 400
    },
    scrollTop() {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
}
</script>

<style lang="scss" scoped>
.scroll-top {
  position: fixed;
  right: 24px;
  bottom: 32px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: var(--season-gradient);
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  z-index: 1000;
  transition: transform 0.2s;
  &:hover { transform: scale(1.08); }
  @media (max-width: 480px) {
    right: 16px;
    bottom: 24px;
  }
}
.fade-up-enter-active, .fade-up-leave-active {
  transition: opacity 0.25s, transform  0.25s;
}
.fade-up-enter, .fade-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>