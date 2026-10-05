<template>
  <section class="page" data-module="conservation">
    <header class="page-head">
      <div>
        <h2>现场保护管理</h2>
        <p class="page-desc">维护保护处理记录，围绕处理编号、保护对象、病害类型、处理材料做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记保护处理记录</button>
        <button class="btn" type="button" @click="exportRows">导出现场保护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>病害优先级</th>
          <th>当前状态</th>
          <th>自动建议</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="priority-tag" :class="`priority-${decide(row).priority}`">
              {{ decide(row).priority }}
            </span>
          </td>
          <td>{{ decide(row).status }}</td>
          <td>
            <template v-if="decide(row).suggestion">
              建议转「{{ decide(row).suggestion }}」
              <em v-if="decide(row).manualLocked" class="lock-hint">现场裁决优先</em>
            </template>
            <span v-else class="muted-text">—</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in decide(row).allowedActions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <RouterLink class="link" :to="`/conservation/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无现场保护数据，可先登记保护处理记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条现场保护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { CONSERVATION_STATUSES, decideConservation } from '@/domain/conservation'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('conservation')
const columns = ["处理编号", "保护对象", "病害类型", "处理材料", "处理方法", "处理日期", "操作人", "处理状态"]
const stats = computed(() => [
  { label: "处理总数", value: rows.value.length },
  { label: "已完成/已稳定", value: rows.value.filter((row) => ['已完成', '已稳定'].includes(decide(row).status)).length },
  { label: "高优先级病害", value: rows.value.filter((row) => decide(row).priority === '高').length },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  CONSERVATION_STATUSES.map((status) => ({
    status,
    count: rows.value.filter((row) => decide(row).status === status).length,
  })),
)

// 列表、详情、回写共用同一份裁决写法。
function decide(row: EntryRow) {
  return decideConservation(row)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '保护处理记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '现场保护列表读取失败'
  }
}

onMounted(reload)
</script>
