<template>
  <div class="page-container">
    <section-title title="图片来源与许可" />
    <p class="credits-intro">
      本站景点与节日封面来自
      <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>，
      仅使用 CC0、Public Domain、CC BY、CC BY-SA 许可。逐图作者与许可如下。
    </p>

    <empty-state v-if="!loading && !groups.length" text="暂无图片署名信息" />

    <section v-for="group in groups" :key="group.key" class="credit-group">
      <h3 class="group-title">{{ group.title }}</h3>
      <div class="credit-grid">
        <a
          v-for="img in group.images"
          :key="img.path"
          class="credit-card"
          :href="img.sourcePage"
          target="_blank"
          rel="noopener noreferrer"
          :title="img.label || img.slug"
        >
          <div class="credit-cover" :style="{ backgroundImage: `url(${img.path})` }"></div>
          <div class="credit-meta">
            <strong>{{ img.label || img.slug }}</strong>
            <span>{{ img.artist || 'Unknown' }} · {{ img.license || 'Unknown' }}</span>
          </div>
        </a>
      </div>
    </section>
  </div>
</template>

<script>
import SectionTitle from '@/components/SectionTitle.vue'
import EmptyState from '@/components/EmptyState.vue'

export default {
  name: 'ImageCreditsView',
  components: { SectionTitle, EmptyState },
  data() {
    return { images: [], loading: true }
  },
  computed: {
    groups() {
      const map = new Map()
      for (const img of this.images) {
        const key = img.group === 'holidays' ? 'holidays' : `dest:${img.slug}`
        if (!map.has(key)) {
          map.set(key, {
            key,
            title: img.group === 'holidays' ? '节日图片' : (img.cityName || img.slug),
            images: []
          })
        }
        map.get(key).images.push(img)
      }
      return [...map.values()].map((g) => ({
        ...g,
        images: g.images.sort((a, b) => (a.slot || 0) - (b.slot || 0))
      }))
    }
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      try {
        const resp = await fetch('/images/credits.json')
        const doc = resp.ok ? await resp.json() : { images: [] }
        this.images = Array.isArray(doc.images) ? doc.images : []
      } catch (e) {
        this.images = []
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.credits-intro {
  color: var(--text-sub);
  font-size: 14px;
  line-height: 1.8;
  margin: 0 0 22px;

  a {
    color: var(--season-accent);
  }
}

.credit-group {
  margin-bottom: 26px;
}

.group-title {
  margin: 0 0 12px;
  font-size: 17px;
  color: var(--text-main);
}

.credit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.credit-card {
  display: block;
  border-radius: var(--radius-card);
  overflow: hidden;
  background: #fff;
  box-shadow: var(--shadow-card);
  color: inherit;
  text-decoration: none;
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-2px);
  }
}

.credit-cover {
  height: 96px;
  background-size: cover;
  background-position: center;
  background-color: #e8e4de;
}

.credit-meta {
  padding: 8px 10px 10px;

  strong {
    display: block;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    color: var(--text-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
