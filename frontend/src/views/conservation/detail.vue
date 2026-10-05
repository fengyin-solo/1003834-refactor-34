<template>
  <section class="page" data-module="conservation-detail" v-if="row">
    <header class="page-head">
      <div>
        <h2>保护处理记录 {{ row['处理编号'] }}</h2>
        <p class="page-desc">详情页与列表、遗物保护回写共用同一状态机；现场处理结论优先于病害自动建议。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/conservation">返回列表</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">当前状态</span>
        <strong class="stat-value">{{ row.status }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">病害优先级</span>
        <strong class="stat-value">{{ row.diseasePriorityLabel }}优先级</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">系统自动建议</span>
        <strong class="stat-value">{{ row.suggestedFinish === '需观察' ? '完成后转观察' : '可直接完结' }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">退回次数</span>
        <strong class="stat-value">{{ row['退回次数'] ?? 0 }}</strong>
      </article>
    </div>

    <table class="data-table detail-table">
      <tbody>
        <tr v-for="field in detailFields" :key="field">
          <th>{{ field }}</th>
          <td>{{ row[field] || '—' }}</td>
        </tr>
        <tr>
          <th>关联遗物保护回写</th>
          <td>{{ linkedArtifactLabel }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="['处理中', '需观察'].includes(String(row.status))" class="action-panel">
      <h3>处理动作</h3>

      <div v-if="String(row.status) === '处理中'" class="decision-block">
        <p class="panel-hint">
          病害「{{ row['病害类型'] }}」自动建议：<strong>{{ row.suggestedFinish === '需观察' ? '完成后转需观察' : '直接已完成' }}</strong>
          ；如现场判断不同，可在下方显式裁决，现场处理优先。
        </p>
        <label class="filter-item">
          <span>现场完结裁决（留空则采纳自动建议）</span>
          <select v-model="siteDecision">
            <option value="">采纳自动建议</option>
            <option value="已完成">现场判定：直接完成</option>
            <option value="需观察">现场判定：完成后观察</option>
          </select>
        </label>
        <div class="row-actions">
          <button class="btn primary" type="button" @click="submit('完成处理')">完成处理</button>
          <button class="btn" type="button" @click="submit('标记观察')">标记观察</button>
        </div>
      </div>

      <div v-else class="decision-block">
        <label class="filter-item note-input">
          <span>观察结论（确认稳定或退回处理前必须填写）</span>
          <textarea v-model="observationNote" rows="3" placeholder="记录复查现象、病害有无复发等"></textarea>
        </label>
        <div class="row-actions">
          <button class="btn primary" type="button" @click="submit('确认稳定')">确认稳定</button>
          <button class="btn" type="button" @click="submit('退回处理')">复查不通过，退回处理</button>
        </div>
      </div>
    </section>

    <section v-else class="action-panel">
      <p class="panel-hint">当前状态「{{ row.status }}」已结案，状态机不允许再执行观察或退回动作。</p>
    </section>

    <footer class="page-foot">
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>

  <section v-else class="page">
    <p class="empty-state">没有找到这条保护处理记录。</p>
    <RouterLink class="btn" to="/conservation">返回列表</RouterLink>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getConservation } from '@/api/conservation-service'
import { useConservationBoard } from './use-conservation'
import type { ConservationViewRow } from '@/api/conservation-service'

const route = useRoute()

const detailFields = [
  '处理编号', '保护对象', '病害类型', '处理材料', '处理方法',
  '处理日期', '操作人', '处理状态', '关联遗物', '观察结论', '现场裁决', '迁移说明',
]

const row = ref<ConservationViewRow | null>(null)
const siteDecision = ref<'' | '需观察' | '已完成'>('')
const observationNote = ref('')

const { errorMessage, noticeMessage, run } = useConservationBoard()

const linkedArtifactLabel = computed(() => {
  if (!row.value || !row.value['关联遗物']) {
    return '无关联遗物'
  }
  return `${row.value['关联遗物']} · 当前回写：${String(row.value.status)}`
})

function load() {
  const id = Number(route.params.id)
  row.value = Number.isFinite(id) ? getConservation(id) : null
  siteDecision.value = ''
  observationNote.value = ''
}

function submit(action: string) {
  if (!row.value) {
    return
  }
  const result = run(Number(row.value.id), action, {
    siteDecision: siteDecision.value,
    observationNote: observationNote.value,
  })
  if (!result.ok) {
    return
  }
  load()
}

watch(() => route.params.id, load)
onMounted(load)
</script>
