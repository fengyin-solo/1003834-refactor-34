<template>
  <section class="page" data-module="artifact">
    <header class="page-head">
      <div>
        <h2>出土遗物管理</h2>
        <p class="page-desc">维护出土遗物，围绕器物编号、出土探方、出土层位、器物质地做登记、筛选与状态流转；送现场保护后由同一套保护状态机回写结论。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记出土遗物</button>
        <button class="btn" type="button" @click="exportRows">导出出土遗物清单</button>
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDispatch(row)">送现场保护</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无出土遗物数据，可先登记出土遗物</td>
        </tr>
      </tbody>
    </table>

    <div v-if="dispatchTarget" class="dispatch-panel" @click.self="closeDispatch">
      <div class="dispatch-card">
        <h3>送现场保护：{{ dispatchTarget['器物编号'] }}</h3>
        <p class="panel-hint">提交后在同一事务内建立「处理中」的保护处理单，并回写本行保护状态；失败会整体回滚。</p>
        <label class="filter-item">
          <span>病害类型（必填）</span>
          <select v-model="dispatchForm.diseaseType">
            <option value="">请选择病害类型</option>
            <option v-for="disease in diseaseTypes" :key="disease" :value="disease">{{ disease }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>现场完结裁决（可空，留空按病害优先级自动建议）</span>
          <select v-model="dispatchForm.siteDecision">
            <option value="">采纳自动建议</option>
            <option value="已完成">现场判定：直接完成</option>
            <option value="需观察">现场判定：完成后观察</option>
          </select>
        </label>
        <label class="filter-item">
          <span>处理方法（可选）</span>
          <input v-model="dispatchForm.processingMethod" placeholder="如：化学缓蚀封护" />
        </label>
        <p v-if="dispatchError" class="error-text">{{ dispatchError }}</p>
        <div class="row-actions panel-actions">
          <button class="btn primary" type="button" @click="confirmDispatch">确认送护</button>
          <button class="btn ghost" type="button" @click="closeDispatch">取消</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条出土遗物记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { dispatchArtifactToConservation } from '@/api/conservation-service'
import { SELECTABLE_DISEASE_TYPES, type SiteFinishDecision } from '@/domain/conservation'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const session = useSessionStore()
const meta = moduleMeta('artifact')
// 模块字段已含「保护回写」，这里只隐藏登记状态列（状态单独成列）。
const columns = ['器物编号', '出土探方', '出土层位', '器物质地', '器物类型', '完残程度', '登记人', '保护回写']
const actions = ['完成清洗', '分配编号', '办理入库']
const statuses = ['已采集', '已清洗', '已编号', '已入库', '借出展示']
const stats = [
  { label: '遗物总数', value: 0 },
  { label: '已入库数', value: 0 },
  { label: '待清洗数', value: 0 },
]
const diseaseTypes = SELECTABLE_DISEASE_TYPES

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['器物编号', '出土探方', '出土层位']
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const dispatchTarget = ref<EntryRow | null>(null)
const dispatchError = ref('')
const dispatchForm = reactive<{
  diseaseType: string
  siteDecision: SiteFinishDecision
  processingMethod: string
}>({
  diseaseType: '',
  siteDecision: '',
  processingMethod: '',
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '出土遗物登记入口尚未接入审批流'
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

function openDispatch(row: EntryRow) {
  dispatchTarget.value = row
  dispatchError.value = ''
  dispatchForm.diseaseType = ''
  dispatchForm.siteDecision = ''
  dispatchForm.processingMethod = ''
}

function closeDispatch() {
  dispatchTarget.value = null
  dispatchError.value = ''
}

function confirmDispatch() {
  if (!dispatchTarget.value) {
    return
  }
  if (!dispatchForm.diseaseType) {
    dispatchError.value = '送现场保护必须先选定病害类型'
    return
  }
  const result = dispatchArtifactToConservation(Number(dispatchTarget.value.id), {
    diseaseType: dispatchForm.diseaseType,
    siteDecision: dispatchForm.siteDecision,
    processingMethod: dispatchForm.processingMethod,
    operator: session.operator,
  })
  if (!result.ok) {
    dispatchError.value = result.message
    return
  }
  closeDispatch()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '出土遗物列表读取失败'
  }
}

onMounted(reload)
</script>
