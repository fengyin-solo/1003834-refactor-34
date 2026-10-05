<template>
  <section class="page" data-module="conservation">
    <header class="page-head">
      <div>
        <h2>现场保护管理</h2>
        <p class="page-desc">维护保护处理记录，围绕处理编号、保护对象、病害类型、处理材料做登记、筛选与状态流转。状态裁决统一走现场保护状态机。</p>
      </div>
      <div class="page-actions">
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

    <form class="filter-bar" @submit.prevent="reload(filters)">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>病害优先级</span>
        <select v-model="priorityFilter">
          <option value="">全部</option>
          <option v-for="priority in priorityOptions" :key="priority" :value="priority">{{ priority }}优先级</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>病害优先级</th>
          <th>自动建议</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visibleRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.diseasePriorityLabel }}优先级</td>
          <td>{{ row.suggestedFinish === '需观察' ? '完成后观察' : '可直接完结' }}</td>
          <td>
            {{ row.status }}
            <span v-if="Number(row['退回次数']) > 0" class="error-text">（已退回 {{ row['退回次数'] }} 次）</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/conservation/${row.id}`">详情</RouterLink>
            <button
              v-for="action in row.availableActions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="row.availableActions.length === 0" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!visibleRows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无符合条件的现场保护记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ visibleRows.length }} 条现场保护记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import { useConservationBoard } from './use-conservation'
import { CONSERVATION_STATUSES } from '@/domain/conservation'

const meta = moduleMeta('conservation')
// 表格列沿用模块字段定义，但「处理状态」与动态字段单独成区，避免重复。
const columns = ['处理编号', '保护对象', '病害类型', '处理材料', '处理方法', '处理日期', '操作人']
const filterFields = ['处理编号', '保护对象', '病害类型']
const priorityOptions = ['高', '中', '低']

const filters = reactive<Record<string, string>>({})
const priorityFilter = ref('')

const { rows, errorMessage, noticeMessage, reload, run, stats } = useConservationBoard()

const visibleRows = computed(() =>
  priorityFilter.value
    ? rows.value.filter((row) => row.diseasePriorityLabel === priorityFilter.value)
    : rows.value,
)

const statusSummary = computed(() =>
  CONSERVATION_STATUSES.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  for (const key of Object.keys(filters)) {
    filters[key] = ''
  }
  priorityFilter.value = ''
  reload({})
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: { id: number; status: string; suggestedFinish: string }) {
  const result = run(Number(row.id), action)
  if (!result.ok) {
    return
  }
  reload({ ...filters })
}

onMounted(() => {
  reload({})
})
</script>
