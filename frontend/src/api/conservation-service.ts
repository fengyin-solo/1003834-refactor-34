// 现场保护应用服务：列表页、详情页、遗物页跨业务回写共用这一层。
// 所有状态变更都先过状态机裁决，再用原子提交一次落库；跨模块写失败整体回滚。

import {
  listRows,
  commitEntries,
} from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import {
  availableConservationActions,
  diseasePriority,
  diseaseSuggestion,
  isConservationStatus,
  transitionConservation,
  type ConservationAction,
  type SiteFinishDecision,
} from '@/domain/conservation'
import type { DiseasePriority } from '@/domain/conservation'
import { filterRows } from '@/api/local-service'

export const CONSERVATION_MODULE_KEY = 'conservation'
const ARTIFACT_MODULE_KEY = 'artifact'

export type ConservationViewRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  diseasePriorityLabel: DiseasePriority
  suggestedFinish: '需观察' | '可完成'
  availableActions: ConservationAction[]
  [field: string]: string | number | boolean | ConservationAction[] | DiseasePriority | '需观察' | '可完成'
}

function toViewRow(row: EntryRow): ConservationViewRow {
  return {
    ...row,
    diseasePriorityLabel: diseasePriority(row['病害类型']),
    suggestedFinish: diseaseSuggestion(row['病害类型']),
    availableActions: availableConservationActions({
      status: String(row.status),
      diseaseType: row['病害类型'],
    }),
  }
}

export function listConservation(
  filters: Record<string, string> = {},
): ConservationViewRow[] {
  return filterRows(listRows(CONSERVATION_MODULE_KEY), filters).map(toViewRow)
}

export function getConservation(id: number): ConservationViewRow | null {
  const row = listRows(CONSERVATION_MODULE_KEY).find((item) => Number(item.id) === id)
  return row ? toViewRow(row) : null
}

export type ConservationActionInput = {
  siteDecision?: SiteFinishDecision
  observationNote?: string
  operator?: string
}

/**
 * 执行现场保护动作。返回失败时存储绝无改动（状态机先拒绝，或原子提交回滚）。
 * 若该记录关联了出土遗物，则在同一事务内回写遗物的「保护回写」字段——
 * 退回或失败不会出现保护页改了、遗物页还是旧结论的半成品。
 */
export function executeConservationAction(
  id: number,
  action: string,
  input: ConservationActionInput = {},
): ActionResult & { row?: ConservationViewRow } {
  const rows = listRows(CONSERVATION_MODULE_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的保护处理记录` }
  }
  const current = rows[index]

  const returnedCount = Number(current['退回次数'] ?? 0)
  const verdict = transitionConservation(action, {
    status: String(current.status),
    diseaseType: current['病害类型'],
    siteDecision: input.siteDecision ?? (String(current['现场裁决'] ?? '') as SiteFinishDecision),
    observationNote:
      input.observationNote ?? (typeof current['观察结论'] === 'string' ? current['观察结论'] : ''),
    returnedCount: Number.isFinite(returnedCount) ? returnedCount : 0,
  })
  if (!verdict.ok || !verdict.status) {
    return { ok: false, message: verdict.message }
  }

  const nextStatus = verdict.status
  const code = String(current['处理编号'] ?? id)
  const linkedArtifact =
    typeof current['关联遗物'] === 'string' ? current['关联遗物'].trim() : ''

  try {
    const nextEntries = commitEntries((draft) => {
      const conservationRows = draft[CONSERVATION_MODULE_KEY] ?? []
      const target = conservationRows[index]
      if (!target || Number(target.id) !== id) {
        throw new Error('保存前记录定位失败，已取消本次操作')
      }
      const updated: EntryRow = {
        ...target,
        status: nextStatus,
        pending: verdict.pending === true,
        abnormal: verdict.abnormal ?? false,
      }
      if (verdict.returnedCount !== undefined) {
        updated['退回次数'] = verdict.returnedCount
      }
      if (action === '完成处理') {
        updated['现场裁决'] = input.siteDecision ?? ''
      }
      if (action === '确认稳定' && input.observationNote) {
        updated['观察结论'] = input.observationNote.trim()
      }
      if (action === '退回处理' && input.observationNote) {
        updated['观察结论'] = `${updated['观察结论'] ?? ''}（复查退回：${input.observationNote.trim()}）`.trim()
      }
      if (input.operator) {
        updated['操作人'] = input.operator
      }
      conservationRows[index] = updated
      draft[CONSERVATION_MODULE_KEY] = conservationRows

      if (linkedArtifact) {
        const artifactRows = draft[ARTIFACT_MODULE_KEY] ?? []
        const artifactIndex = artifactRows.findIndex(
          (item) => String(item['器物编号']) === linkedArtifact,
        )
        if (artifactIndex >= 0) {
          artifactRows[artifactIndex] = {
            ...artifactRows[artifactIndex],
            '保护回写': `${code} ${nextStatus}`,
          }
          draft[ARTIFACT_MODULE_KEY] = artifactRows
        }
      }
      return draft
    })
    const saved = nextEntries[CONSERVATION_MODULE_KEY][index]
    return {
      ok: true,
      message: `保护处理记录已${action}，当前状态「${nextStatus}」`,
      row: toViewRow(saved),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '现场保护状态保存失败，已回滚',
    }
  }
}

type DispatchInput = {
  diseaseType: string
  operator: string
  /** 现场对完结结论的显式裁决，可空；为空时按病害优先级自动建议。 */
  siteDecision?: SiteFinishDecision
  processingMethod?: string
}

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextConservationCode(rows: EntryRow[]): string {
  const max = rows.reduce((highest, row) => Math.max(highest, Number(row.id) || 0), 0)
  return `CONS-${String(max + 1).padStart(4, '0')}`
}

/**
 * 出土遗物页跨业务动作「送现场保护」：
 * 经同一状态机把新单从「待处理」开始处理（病害非法会被状态机拒绝），
 * 再在同一事务里落库保护记录并回写遗物行。
 * 任一步失败整体回滚，遗物不会被标记成已送保护却找不到处理单。
 */
export function dispatchArtifactToConservation(
  artifactId: number,
  input: DispatchInput,
): ActionResult & { conservationId?: number } {
  // 先过状态机：只有合法病害才能「开始处理」，跨业务面与列表/详情裁决完全一致。
  const start = transitionConservation('开始处理', {
    status: '待处理',
    diseaseType: input.diseaseType,
  })
  if (!start.ok || !start.status) {
    return { ok: false, message: start.message }
  }
  const initialStatus = start.status

  let createdId = 0
  try {
    commitEntries((draft) => {
      const artifactRows = draft[ARTIFACT_MODULE_KEY] ?? []
      const artifactIndex = artifactRows.findIndex((item) => Number(item.id) === artifactId)
      if (artifactIndex < 0) {
        throw new Error('没有找到这条出土遗物')
      }
      const artifact = artifactRows[artifactIndex]
      const code = String(artifact['器物编号'] ?? artifactId)

      const conservationRows = draft[CONSERVATION_MODULE_KEY] ?? []
      const alreadyLinked = conservationRows.some(
        (row) =>
          String(row['关联遗物'] ?? '') === code &&
          isConservationStatus(String(row.status)) &&
          !['已完成', '已稳定'].includes(String(row.status)),
      )
      if (alreadyLinked) {
        throw new Error(`遗物 ${code} 已有未结案的保护处理记录，不能重复送护`)
      }

      createdId =
        conservationRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
      const conservationCode = nextConservationCode(conservationRows)
      const record: EntryRow = {
        id: createdId,
        status: initialStatus,
        pending: start.pending === true,
        abnormal: start.abnormal ?? false,
        '处理编号': conservationCode,
        '保护对象': `出土遗物 ${code}`,
        '病害类型': input.diseaseType,
        '处理材料': '',
        '处理方法': input.processingMethod ?? '',
        '处理日期': todayLabel(),
        '操作人': input.operator,
        '处理状态': initialStatus,
        '关联遗物': code,
        '现场裁决': input.siteDecision ?? '',
        '观察结论': '',
        '退回次数': 0,
      }
      draft[CONSERVATION_MODULE_KEY] = [...conservationRows, record]

      artifactRows[artifactIndex] = {
        ...artifact,
        '保护回写': `${conservationCode} ${initialStatus}`,
      }
      draft[ARTIFACT_MODULE_KEY] = artifactRows
      return draft
    })
    return {
      ok: true,
      conservationId: createdId,
      message: `已送现场保护，处理单经状态机进入「${initialStatus}」，遗物保护回写已同步`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '送现场保护失败，已回滚',
    }
  }
}
