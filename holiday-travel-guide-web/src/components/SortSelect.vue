<template>
  <el-select
    :value="value"
    placeholder="排序"
    class="sort-select"
    @change="onChange"
  >
    <el-option label="综合浏览" value="views" />
    <el-option label="最新发布" value="latest" />
    <el-option label="热门榜" value="hot" />
  </el-select>
</template>

<script>
export default {
  name: 'SortSelect',
  props: {
    value: { type: String, default: 'views' }
  },
  methods: {
    onChange(val) {
      // 同时触发 input（v-model 双向绑定）和 change（父组件监听查询）
      this.$emit('input', val)
      this.$emit('change', val)
    }
  }
}
</script>

<style lang="scss" scoped>
.sort-select {
  width: 150px;
}
@media (max-width: 768px) {
  .sort-select {
    width: 100%;
  }
}
</style>