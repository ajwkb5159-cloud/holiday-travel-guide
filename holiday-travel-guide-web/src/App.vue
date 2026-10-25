<template>
  <div id="app">
    <app-header />
    <main class="app-main">
      <transition name="fade" mode="out-in">
        <router-view />
      </transition>
    </main>
    <app-footer />
    <scroll-top-button />
    <ai-chat-widget />
    <maintenance-overlay />
  </div>
</template>

<script>
import AppHeader from '@/components/AppHeader.vue'
import AppFooter from '@/components/AppFooter.vue'
import ScrollTopButton from '@/components/ScrollTopButton.vue'
import AiChatWidget from '@/components/AiChatWidget.vue'
import MaintenanceOverlay from '@/components/MaintenanceOverlay.vue'
import { seasonOfMonth } from '@/utils/season'

export default {
  name: 'App',
  components: { AppHeader, AppFooter, ScrollTopButton, AiChatWidget, MaintenanceOverlay },
  mounted() {
    document.body.setAttribute('data-season', seasonOfMonth())
  }
}
</script>

<style lang="scss">
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter,
.fade-leave-to {
  opacity: 0;
}
</style>
