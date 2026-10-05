import type { EntryRow } from '@/data/types'

// 现场保护共用状态机：列表、详情、跨业务面（出土遗物入库回写）的状态与病害判定
// 全部收口到这里，任何页面都不得再自行写一份「能不能流转 / 病害严不严重」的判断。

export const CONSERVATION_KEY = 'conservation'

export const CONSERVATION_STATUSES = [
  '待处理',
  '处理中',
  '已完成',
  '需观察',
  '已稳定',
] as const
export type ConservationStatus = (typeof CONSERVATION_STATUSES)[number]

export const CONSERVATION_ACTIONS = [
  '开始处理',
  '完成处理',
  '标记观察',
  '确认稳定',
] as const
export type ConservationAction = (typeof CONSERVATION_ACTIONS)[number]

export type DiseasePriority = '高' | '中' | '低'

// 唯一允许的状态迁移表：动作只能从指定的源状态发起，
// 从根上杜绝「已完成仍标记观察」「需观察直接跳到已稳定」这类越轨流转。
const TRANSITIONS: Record<ConservationAction, { from: ConservationStatus[]; to: ConservationStatus }> = {
  开始处理: { from: ['待处理'], to: '处理中' },
  完成处理: { from: ['处理中'], to: '已完成' },
  标记观察: { from: ['待处理', '处理中'], to: '需观察' },
  确认稳定: { from: ['需观察'], to: '已稳定' },
}

// 现场已经裁决过的终局状态：自动建议（含遗物入库回写）只能提示，不得覆盖。
const MANUAL_LOCKED: readonly ConservationStatus[] = ['已完成', '已稳定']
// 不再有待办动作的状态。
const SETTLED: readonly ConservationStatus[] = ['已完成', '已稳定']

export type TransitionResult = {
  ok: boolean
  target?: ConservationStatus
  reason?: string
}

export function transitionConservation(
  action: string,
  current: string,
): TransitionResult {
  const rule = TRANSITIONS[action as ConservationAction]
  if (!rule) {
    return { ok: false, reason: `现场保护没有登记「${action}」这个动作` }
  }
  if (!CONSERVATION_STATUSES.includes(current as ConservationStatus)) {
    return { ok: false, reason: `当前状态「${current}」不在现场保护状态机内` }
  }
  if (!rule.from.includes(current as ConservationStatus)) {
    return {
      ok: false,
      reason: `「${current}」的记录不能${action}，仅${rule.from.join('、')}状态可执行`,
    }
  }
  return { ok: true, target: rule.to }
}

export function availableActions(status: string): ConservationAction[] {
  return CONSERVATION_ACTIONS.filter((action) =>
    TRANSITIONS[action].from.includes(status as ConservationStatus),
  )
}

export function isManualLocked(status: string): boolean {
  return MANUAL_LOCKED.includes(status as ConservationStatus)
}

export function isPendingStatus(status: string): boolean {
  return !SETTLED.includes(status as ConservationStatus)
}

// 病害类型 -> 优先级：关键词按从严到宽匹配，命中即定档。
const PRIORITY_RULES: ReadonlyArray<{ priority: DiseasePriority; keywords: string[] }> = [
  { priority: '高', keywords: ['酥粉', '霉变', '严重残', '碎裂', '病害待判定'] },
  { priority: '中', keywords: ['风化', '裂隙', '剥落', '起翘', '锈蚀', '残损', '历史遗留'] },
  { priority: '低', keywords: ['污渍', '附着物', '沉积', '水渍'] },
]
const DEFAULT_PRIORITY: DiseasePriority = '中'

export type PriorityResult = {
  priority: DiseasePriority
  basis: string
}

export function diseasePriority(diseaseType: string): PriorityResult {
  const text = diseaseType.trim()
  for (const rule of PRIORITY_RULES) {
    const hit = rule.keywords.find((keyword) => text.includes(keyword))
    if (hit) {
      return { priority: rule.priority, basis: `${rule.priority}优先级病害：${hit}` }
    }
  }
  return { priority: DEFAULT_PRIORITY, basis: `病害类型未登记分级，按${DEFAULT_PRIORITY}优先级处理` }
}

// 自动建议：仅在高优先级病害且现场尚未裁决时提示「需观察」。
// 已完成 / 已稳定属于现场终局裁决，任何自动建议都不得改写。
export function suggestConservationStatus(row: Pick<EntryRow, 'status'> & {
  病害类型?: string | number | boolean
}): ConservationStatus | null {
  const status = String(row.status)
  if (isManualLocked(status)) {
    return null
  }
  const { priority } = diseasePriority(String(row.病害类型 ?? ''))
  if (priority === '高' && (status === '待处理' || status === '处理中')) {
    return '需观察'
  }
  return null
}

// 出土遗物「完残程度」到现场保护病害类型的映射：完整器不产生保护回写。
export function diseaseFromArtifactCondition(condition: string): string | null {
  const text = condition.trim()
  if (!text || text.includes('完整')) {
    return null
  }
  if (text.includes('酥') || text.includes('碎') || text.includes('严重残')) {
    return '酥粉碎裂'
  }
  if (text.includes('裂') || text.includes('残') || text.includes('缺')) {
    return '残损裂隙'
  }
  return '残损裂隙'
}

// 回写新建保护记录时的起始状态：高优先级直接挂「需观察」，其余进「待处理」排队。
export function initialStatusForDisease(diseaseType: string): ConservationStatus {
  const { priority } = diseasePriority(diseaseType)
  return priority === '高' ? '需观察' : '待处理'
}

export type ConservationDecision = {
  status: ConservationStatus
  priority: DiseasePriority
  priorityBasis: string
  suggestion: ConservationStatus | null
  manualLocked: boolean
  allowedActions: ConservationAction[]
}

// 列表与详情共用的同一份裁决写法。
export function decideConservation(row: EntryRow): ConservationDecision {
  const status = String(row.status) as ConservationStatus
  const { priority, basis } = diseasePriority(String(row.病害类型 ?? ''))
  return {
    status,
    priority,
    priorityBasis: basis,
    suggestion: suggestConservationStatus(row),
    manualLocked: isManualLocked(status),
    allowedActions: availableActions(status),
  }
}

// 历史记录迁移：早期记录没有病害类型，按处理日期补档——
// 迁移基准日（含）之前的老记录记为历史遗留病害，之后缺失的记为病害待判定，等待人工复核。
export const DISEASE_MIGRATION_CUTOFF = '2026-09-01'
export const LEGACY_DISEASE_TYPE = '历史遗留病害'
export const UNKNOWN_DISEASE_TYPE = '病害待判定'

export function migrateConservationRows(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    const diseaseType = String(row.病害类型 ?? '').trim()
    if (diseaseType) {
      return row
    }
    const treatedAt = String(row.处理日期 ?? '').trim()
    const migrated = Boolean(treatedAt) && treatedAt <= DISEASE_MIGRATION_CUTOFF
    return { ...row, 病害类型: migrated ? LEGACY_DISEASE_TYPE : UNKNOWN_DISEASE_TYPE }
  })
}
