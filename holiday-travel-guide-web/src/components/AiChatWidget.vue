<template>
  <div v-if="aiEnabled" class="ai-widget">
    <!-- 对话面板 -->
    <transition name="ai-pop">
      <div v-show="open" class="ai-panel" role="dialog" aria-label="AI 行程助手">
        <div class="panel-head">
          <div class="head-title">
            <span class="head-icon">🤖</span>
            <div>
              <div class="head-name">AI 行程助手</div>
              <div class="head-sub">{{ quotaExhausted ? '今日次数已用完' : '基于站内攻略的智能规划' }}</div>
            </div>
          </div>
          <button class="head-close" title="收起" @click="open = false">✕</button>
        </div>

        <div ref="msgsEl" class="panel-msgs">
          <div
            v-for="(m, i) in messages"
            :key="i"
            class="msg-row"
            :class="'row-' + m.role"
          >
            <div class="msg-bubble" :class="{ 'bubble-error': m.error }">
              <span class="msg-text">{{ m.text }}</span>
              <span v-if="m.typing" class="typing-cursor">▌</span>
              <div v-if="m.sources && m.sources.length" class="msg-sources">
                <div
                  v-for="s in m.sources"
                  :key="s.Index"
                  class="source-chip"
                  :style="{ backgroundImage: `url(${s.CoverImage || ''}), var(--season-gradient)` }"
                  @click="goGuide(s.Id)"
                >
                  <span class="source-tag">[{{ s.Index }}]</span>
                  <span class="source-title">{{ s.Title }}</span>
                </div>
              </div>
              <button v-if="m.error && lastQuestion && !sending" class="retry-btn" @click="send(lastQuestion)">重试</button>
            </div>
          </div>

          <div v-if="quickChips.length && !sending" class="quick-chips">
            <button v-for="q in quickChips" :key="q" class="chip" @click="send(q)">{{ q }}</button>
          </div>
        </div>

        <div class="panel-input">
          <input
            v-model.trim="draft"
            type="text"
            maxlength="500"
            placeholder="例如：国庆北京3日游？"
            :disabled="quotaExhausted"
            @keyup.enter="send()"
          />
          <button class="send-btn" :disabled="!draft || sending || quotaExhausted" @click="send()">
            {{ sending ? '…' : '发送' }}
          </button>
        </div>
        <div class="panel-foot">
          <template v-if="remaining != null">今日剩余 {{ remaining }}/{{ limit }} 次 · </template>
          AI 生成内容仅供参考，出行前请核实票务与开放信息
        </div>
      </div>
    </transition>

    <!-- 悬浮球（与回到顶部按钮上下错位） -->
    <button class="ai-ball" title="AI 行程助手" @click="toggleOpen">
      <span class="ball-icon">🤖</span>
      <span v-if="remaining != null && remaining <= 3" class="ball-badge">{{ remaining }}</span>
    </button>
  </div>
</template>

<script>
import { getAiStatus, getAiQuota, streamChat } from '@/api/ai'

const QUICK_PROMPTS = ['国庆节去哪玩人少？', '推荐一个 3 天的亲子游', '冬天适合去哪看雪？', '带父母出游有什么建议？']

export default {
  name: 'AiChatWidget',
  data() {
    return {
      aiEnabled: false,
      open: false,
      draft: '',
      sending: false,
      messages: [],
      sources: [], // 最新回答的引用（挂在对应消息上）
      remaining: null,
      limit: null,
      quotaLoaded: false,
      quotaExhausted: false,
      lastQuestion: ''
    }
  },
  computed: {
    quickChips() {
      // 只在「尚无用户消息」时展示快捷提问
      return this.messages.some(m => m.role === 'user') ? [] : QUICK_PROMPTS.slice(0, 3)
    }
  },
  created() {
    getAiStatus().then(s => { this.aiEnabled = !!s.Enabled })
  },
  methods: {
    toggleOpen() {
      this.open = !this.open
      if (this.open && !this.quotaLoaded) {
        this.quotaLoaded = true
        getAiQuota()
          .then(q => {
            this.remaining = q.Remaining
            this.limit = q.Limit
            this.quotaExhausted = q.Remaining <= 0
            if (this.messages.length === 0 && !this.quotaExhausted) {
              this.messages.push({ role: 'ai', text: '你好！我是站内 AI 行程助手 🎒\n可以问我节假日出行安排，我会结合站内攻略给你定制建议～' })
            }
          })
          .catch(() => { /* 额度未知不阻塞使用；发送失败时再提示 */ })
      }
    },
    goGuide(id) {
      this.open = false
      this.$router.push(`/guides/${id}`)
    },
    buildHistory() {
      // 最近 3 轮（6 条）作为上下文，剔除错误气泡与打字光标
      return this.messages
        .filter(m => !m.error && !m.typing && m.text)
        .slice(-6)
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
    },
    scrollToBottom() {
      this.$nextTick(() => {
        const el = this.$refs.msgsEl
        if (el) el.scrollTop = el.scrollHeight
      })
    },
    send(text) {
      const q = (text || this.draft || '').trim()
      if (!q || this.sending) return
      this.lastQuestion = q
      this.draft = ''
      this.sending = true

      const aiMsg = { role: 'ai', text: '', typing: true, sources: [] }
      this.messages.push({ role: 'user', text: q }, aiMsg)
      this.scrollToBottom()

      let received = false
      streamChat({
        question: q,
        history: this.buildHistory(),
        onDelta: (t) => {
          received = true
          aiMsg.text += t
          this.scrollToBottom()
        },
        onSources: (list) => { aiMsg.sources = list },
        onDone: (p) => {
          if (typeof p.Remaining === 'number') {
            this.remaining = p.Remaining
            this.limit = p.Limit
          }
        }
      })
        .then(() => {
          aiMsg.typing = false
          if (!aiMsg.text) aiMsg.text = '（AI 没有返回内容，请换个问法试试）'
        })
        .catch((err) => {
          aiMsg.typing = false
          if (received) {
            // 已有部分内容：追加中断提示而不是清空
            aiMsg.text += '\n\n（回答中断了，请重新提问）'
          } else {
            aiMsg.error = true
            aiMsg.text = this.friendlyError(err)
            if (err.status === 429 && err.data && typeof err.data.Remaining === 'number') {
              this.quotaExhausted = true
              this.remaining = err.data.Remaining
            }
          }
        })
        .finally(() => {
          this.sending = false
          this.scrollToBottom()
        })
    },
    friendlyError(err) {
      if (err.status === 429) {
        return err.data && typeof err.data.Remaining === 'number'
          ? '今日免费咨询次数已用完，明天再来吧～'
          : (err.message || '当前咨询人数较多，请稍后再试')
      }
      if (err.status === 503) return '服务器繁忙，请稍后重试'
      if (err.status === 501) { this.aiEnabled = false; return 'AI 功能未开启' }
      return err.aiError ? (err.message || 'AI 服务暂时不可用') : '网络异常，请稍后重试'
    }
  }
}
</script>

<style lang="scss" scoped>
// ---------- 悬浮球 ----------
.ai-ball {
  position: fixed;
  right: 24px;
  bottom: 88px; // 与 ScrollTopButton(bottom:32px) 上下错位
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: var(--season-gradient);
  color: #fff;
  font-size: 24px;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  z-index: 1001;
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.08);
  }
}

.ball-icon {
  line-height: 1;
}

.ball-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #f56c6c;
  display: flex;
  align-items: center;
  justify-content: center;
}

// ---------- 对话面板 ----------
.ai-panel {
  position: fixed;
  right: 24px;
  bottom: 150px;
  width: 384px;
  max-width: calc(100vw - 32px);
  height: 560px;
  max-height: min(72vh, 620px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
  z-index: 1200;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--season-gradient);
  color: #fff;
  flex-shrink: 0;
}

.head-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.head-icon {
  font-size: 26px;
}

.head-name {
  font-size: 15px;
  font-weight: 700;
}

.head-sub {
  font-size: 12px;
  opacity: 0.9;
}

.head-close {
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;

  &:hover {
    background: rgba(255, 255, 255, 0.35);
  }
}

.panel-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 6px;
  background: var(--bg, #faf9f7);
}

.msg-row {
  display: flex;
  margin-bottom: 12px;

  &.row-user {
    justify-content: flex-end;
  }

  &.row-ai {
    justify-content: flex-start;
  }
}

.msg-bubble {
  max-width: 86%;
  padding: 10px 13px;
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.65;
}

.row-user .msg-bubble {
  background: var(--season-gradient);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.row-ai .msg-bubble {
  background: #fff;
  color: var(--text-main, #2d2a26);
  box-shadow: var(--shadow-card, 0 2px 8px rgba(0, 0, 0, 0.06));
  border-bottom-left-radius: 4px;
}

.bubble-error {
  background: #fef0f0;
  color: #c45656;
}

.msg-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.typing-cursor {
  display: inline-block;
  animation: blink 0.9s infinite;
  opacity: 0.6;
}

@keyframes blink {
  50% { opacity: 0; }
}

.msg-sources {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.source-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 10px;
  background-size: cover;
  background-position: center;
  background-color: var(--text-main, #2d2a26); // 图片加载失败的兜底色
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.15s;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
  }

  &:hover {
    transform: translateX(2px);
  }
}

.source-tag {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 700;
  color: #ffd04b;
  flex-shrink: 0;
}

.source-title {
  position: relative;
  z-index: 1;
  font-size: 12px;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 10px;
}

.chip {
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: var(--text-sub, #6b6660);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: var(--primary, #d9534f);
    border-color: var(--primary, #d9534f);
  }
}

.retry-btn {
  margin-top: 8px;
  border: none;
  background: var(--season-gradient);
  color: #fff;
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 12px;
  cursor: pointer;
}

.panel-input {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: #fff;
  flex-shrink: 0;

  input {
    flex: 1;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;

    &:focus {
      border-color: var(--primary, #d9534f);
    }

    &:disabled {
      background: #f5f5f5;
      cursor: not-allowed;
    }
  }
}

.send-btn {
  border: none;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--season-gradient);
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.panel-foot {
  padding: 6px 14px 9px;
  font-size: 11px;
  color: var(--text-sub, #999);
  background: #fff;
  flex-shrink: 0;
}

// ---------- 进出动画 ----------
.ai-pop-enter-active,
.ai-pop-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.ai-pop-enter,
.ai-pop-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.98);
}

// ---------- 移动端：全屏面板 ----------
@media (max-width: 480px) {
  .ai-ball {
    right: 16px;
    bottom: 78px;
    width: 48px;
    height: 48px;
  }

  .ai-panel {
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    border-radius: 0;
  }
}
</style>
