// 现场保护历史数据迁移：旧记录普遍没填病害类型，状态机判定需要它。
// 规则：按「处理日期」升序逐条补填兜底类型并留痕；迁移幂等，重复执行不会二次改写。

import type { EntryRow } from '@/data/types'
import { LEGACY_DISEASE_TYPE } from './disease'
import {
  CONSERVATION_STATUSES,
  isPendingStatus,
  type ConservationStatus,
} from './state-machine'

export const CONSERVATION_KEY = 'conservation'
export const MIGRATION_BACKFILL_DISEASE = 'conservation-backfill-disease-type'

function hasDiseaseValue(row: EntryRow): boolean {
  const value = row['病害类型']
  return typeof value === 'string' && value.trim() !== ''
}

function toDateValue(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '') {
    // 没有处理日期的旧记录排到最后，保持稳定次序。
    return Number.POSITIVE_INFINITY
  }
  const time = new Date(value.trim()).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

/**
 * v1 → v2：
 * - 按处理日期升序为缺少病害类型的现场保护记录补填兜底类型；
 * - 依据状态机重新校准 pending 标记，避免旧数据的标记与状态打架；
 * - 非法状态回到「待处理」。
 * 返回迁移说明，供存储层记录（不在控制台以外产生副作用）。
 */
export function migrateConservationLegacy(
  entries: Record<string, EntryRow[]>,
): { entries: Record<string, EntryRow[]>; changed: number; note: string } {
  const rows = entries[CONSERVATION_KEY]
  if (!rows || rows.length === 0) {
    return { entries, changed: 0, note: '无现场保护记录需要迁移' }
  }

  const missing = rows
    .filter((row) => !hasDiseaseValue(row))
    .sort((a, b) => toDateValue(a['处理日期']) - toDateValue(b['处理日期']))

  const sequenceById = new Map(missing.map((row, index) => [Number(row.id), index + 1]))

  const nextRows = rows.map((row) => {
    const next: EntryRow = { ...row }

    const rawStatus = String(next.status ?? '')
    if (!(CONSERVATION_STATUSES as readonly string[]).includes(rawStatus)) {
      next.status = CONSERVATION_STATUSES[0] satisfies ConservationStatus
    }
    next.pending = isPendingStatus(String(next.status))
    if (next['退回次数'] === undefined) {
      next['退回次数'] = 0
    }

    if (!hasDiseaseValue(next)) {
      const sequence = sequenceById.get(Number(next.id)) ?? 0
      next['病害类型'] = LEGACY_DISEASE_TYPE
      next['迁移说明'] = `历史记录缺少病害类型，迁移时按处理日期第 ${sequence} 条补填`
    }
    return next
  })

  return {
    entries: { ...entries, [CONSERVATION_KEY]: nextRows },
    changed: missing.length,
    note:
      missing.length > 0
        ? `已按处理日期升序为 ${missing.length} 条历史保护记录补填病害类型`
        : '现场保护历史记录无需补填病害类型',
  }
}
