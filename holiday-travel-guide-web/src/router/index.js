import Vue from 'vue'
import VueRouter from 'vue-router'
import Home from '@/views/Home/HomeView.vue'
import { setDocumentTitle } from '@/utils/title'

Vue.use(VueRouter)

const router = new VueRouter({
  mode: 'history',
  routes: [
    { path: '/', name: 'home', component: Home, meta: { title: '首页' } },
    { path: '/guides', name: 'guide-list', component: () => import('@/views/Guide/GuideListView.vue'), meta: { title: '全部攻略' } },
    { path: '/guides/:id', name: 'guide-detail', component: () => import('@/views/Guide/GuideDetailView.vue'), meta: { title: '攻略详情' } },
    { path: '/destinations', name: 'destination-list', component: () => import('@/views/Destination/DestinationListView.vue'), meta: { title: '目的地' } },
    { path: '/destinations/:name', name: 'destination-detail', component: () => import('@/views/Destination/DestinationDetailView.vue'), meta: { title: '目的地图文' } },
    { path: '/holidays', name: 'holiday-list', component: () => import('@/views/Holiday/HolidayListView.vue'), meta: { title: '节假日专题' } },
    { path: '/search', name: 'search', component: () => import('@/views/Search/SearchView.vue'), meta: { title: '搜索' } },
    { path: '/tags', name: 'tags', component: () => import('@/views/Tag/TagView.vue'), meta: { title: '标签云' } },
    { path: '/favorites', name: 'favorites', component: () => import('@/views/Favorite/FavoriteView.vue'), meta: { title: '我的收藏' } },
    { path: '*', redirect: '/' }
  ],
  scrollBehavior: () => ({ x: 0, y: 0 })
})

// 路由切换设 document.title（SPA 无 SSR meta，至少让浏览器标签/分享卡片有语义化标题）
router.afterEach((to) => {
  setDocumentTitle(to.meta && to.meta.title)
})

export default router