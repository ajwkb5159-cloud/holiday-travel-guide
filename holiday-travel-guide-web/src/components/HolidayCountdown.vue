<template>
  <div class="countdown-card" :class="{ arrived: holiday.DaysLeft < 0 }">
    <div class="cd-date">{{ dateText }}</div>
    <div class="cd-name">{{ holiday.Name }}</div>
    <div class="cd-days">
      <span class="num">{{ displayDays }}</span>
      <span class="unit">天</span>
    </div>
  </div>
</template>

<script>
export default {
  name: 'HolidayCountdown',
  props: {
    holiday: { type: Object, required: true }
  },
  computed: {
    dateText() {
      return this.holiday.Date || ''
    },
    displayDays() {
      if (this.holiday.DaysLeft === 0) return '今天'
      return Math.abs(this.holiday.DaysLeft)
    }
  }
}
</script>

<style lang="scss" scoped>
.countdown-card {
  background: #fff;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 14px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 120px;

  .cd-date {
    font-size: 12px;
    color: var(--text-sub);
  }

  .cd-name {
    font-size: 15px;
    font-weight: 600;
  }

  .cd-days {
    display: flex;
    align-items: baseline;
    gap: 4px;

    .num {
      font-size: 30px;
      font-weight: 800;
      background: var(--season-gradient);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .unit {
      font-size: 13px;
      color: var(--text-sub);
    }
  }

  &.arrived {
    opacity: 0.6;
  }
}
</style>
