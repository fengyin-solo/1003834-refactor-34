import { computed, ref } from 'vue'

import {
  executeConservationAction,
  listConservation,
  type ConservationActionInput,
  type ConservationViewRow,
} from '@/api/conservation-service'
import type { ActionResult } from '@/data/types'

// 列表页与详情页共用：同一套读取、动作执行、统计口径，杜绝两个页面各写各的判定。
export function useConservationBoard() {
  const rows = ref<ConservationViewRow[]>([])
  const errorMessage = ref('')
  const noticeMessage = ref('')

  function reload(filters: Record<string, string> = {}) {
    errorMessage.value = ''
    try {
      rows.value = listConservation(filters)
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '现场保护列表读取失败'
    }
  }

  function run(
    id: number,
    action: string,
    input: ConservationActionInput = {},
  ): ActionResult {
    errorMessage.value = ''
    noticeMessage.value = ''
    const result = executeConservationAction(id, action, input)
    if (!result.ok) {
      errorMessage.value = result.message
    } else {
      noticeMessage.value = result.message
    }
    return result
  }

  const stats = computed(() => {
    const items = rows.value
    return [
      { label: '处理总数', value: items.length },
      { label: '已结案数', value: items.filter((row) => ['已完成', '已稳定'].includes(String(row.status))).length },
      { label: '待处理数', value: items.filter((row) => Number(row.pending) > 0).length },
      { label: '观察中数', value: items.filter((row) => String(row.status) === '需观察').length },
    ]
  })

  return { rows, errorMessage, noticeMessage, reload, run, stats }
}
