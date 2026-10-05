<template>
  <section class="page" data-module="conservation-detail">
    <header class="page-head">
      <div>
        <h2>保护处理记录详情</h2>
        <p class="page-desc">单条记录的病害优先级、自动建议与现场动作均由同一份现场保护状态机裁决。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/conservation">返回列表</RouterLink>
      </div>
    </header>

    <div v-if="!row" class="detail-empty">
      <p class="error-text">{{ errorMessage || '没有找到这条保护处理记录' }}</p>
      <RouterLink class="btn" to="/conservation">返回列表</RouterLink>
    </div>

    <template v-else-if="decision">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ decision.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">病害优先级</span>
          <strong class="stat-value">
            <span class="priority-tag" :class="`priority-${decision.priority}`">{{ decision.priority }}</span>
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">自动建议</span>
          <strong class="stat-value">
            {{ decision.suggestion ? `转「${decision.suggestion}」` : '维持现状' }}
          </strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ row[field] ?? '—' }}</td>
          </tr>
          <tr>
            <th>优先级判定依据</th>
            <td>{{ decision.priorityBasis }}</td>
          </tr>
        </tbody>
      </table>

      <p class="suggestion-banner" v-if="decision.suggestion && !decision.manualLocked">
        自动建议：该记录病害优先级为「{{ decision.priority }}」，可考虑转「{{ decision.suggestion }}」；是否执行仍由现场处理决定。
      </p>
      <p class="suggestion-banner locked" v-else-if="decision.manualLocked">
        现场已裁决为「{{ decision.status }}」，自动观察建议不再改写本记录（现场处理优先于自动建议）。
      </p>

      <div class="detail-actions">
        <button
          v-for="action in decision.allowedActions"
          :key="action"
          class="btn primary"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
        <span v-if="!decision.allowedActions.length" class="muted-text">该状态下没有可执行动作</span>
        <span v-if="actionMessage" :class="actionMessage.ok ? 'ok-text' : 'error-text'">
          {{ actionMessage.text }}
        </span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getEntry, runAction as applyAction } from '@/api/local-service'
import { decideConservation } from '@/domain/conservation'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const fields = ["处理编号", "保护对象", "病害类型", "处理材料", "处理方法", "处理日期", "操作人", "处理状态"]

const row = ref<EntryRow | null>(getEntry('conservation', Number(route.params.id)))
const errorMessage = ref('')
const actionMessage = ref<{ ok: boolean; text: string } | null>(null)

const decision = computed(() => (row.value ? decideConservation(row.value) : null))

function runAction(action: string) {
  if (!row.value) {
    return
  }
  actionMessage.value = null
  const result = applyAction('conservation', Number(row.value.id), action)
  if (!result.ok) {
    actionMessage.value = { ok: false, text: result.message }
    return
  }
  row.value = getEntry('conservation', Number(row.value.id))
  actionMessage.value = { ok: true, text: result.message }
}
</script>
