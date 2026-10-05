// 现场保护处理状态机：列表、详情、遗物保护回写三处共用同一份流转裁决。
// 规则要点：
// 1. 只有「处理中」才能完结；「已完成」是终态，不能再标记观察（修掉已完成仍可观察的旧问题）。
// 2. 「需观察」只能先登记观察结论，再确认稳定；不允许一步跳到「已稳定」（修掉观察可直达稳定的旧问题）。
// 3. 完结落点由病害自动建议给出，但现场显式裁决永远优先（见 resolveFinishTarget）。

import { isKnownDisease, resolveFinishTarget, type DiseasePriority } from './disease'

export const CONSERVATION_STATUSES = ['待处理', '处理中', '已完成', '需观察', '已稳定'] as const
export type ConservationStatus = (typeof CONSERVATION_STATUSES)[number]

export const CONSERVATION_ACTIONS = [
  '开始处理',
  '完成处理',
  '标记观察',
  '确认稳定',
  '退回处理',
] as const
export type ConservationAction = (typeof CONSERVATION_ACTIONS)[number]

export type SiteFinishDecision = '需观察' | '已完成' | ''

export type TransitionInput = {
  status: string
  diseaseType?: unknown
  /** 现场对完结结论的显式裁决：优先于病害自动建议。 */
  siteDecision?: SiteFinishDecision
  /** 观察结论：从「需观察」确认稳定前必须留痕。 */
  observationNote?: string
  /** 已有退回次数：每次退回累加，用于异常标记。 */
  returnedCount?: number
}

export type TransitionOutcome = {
  ok: boolean
  status?: ConservationStatus
  pending?: boolean
  abnormal?: boolean
  returnedCount?: number
  message: string
}

const TERMINAL_STATUSES: ConservationStatus[] = ['已完成', '已稳定']

export function isConservationStatus(value: unknown): value is ConservationStatus {
  return typeof value === 'string' && (CONSERVATION_STATUSES as readonly string[]).includes(value)
}

/** 未终结：待处理、处理中、需观察都还要继续跟进。 */
export function isPendingStatus(status: string): boolean {
  return !TERMINAL_STATUSES.includes(status as ConservationStatus)
}

function fail(message: string): TransitionOutcome {
  return { ok: false, message }
}

/**
 * 状态机唯一入口：给定当前状态、动作与上下文，返回下一状态或拒绝原因。
 * 不碰存储，不碰页面，只做纯裁决。
 */
export function transitionConservation(
  action: string,
  input: TransitionInput,
): TransitionOutcome {
  const current = isConservationStatus(input.status)
    ? input.status
    : (CONSERVATION_STATUSES[0] as ConservationStatus)
  const returnedCount = input.returnedCount ?? 0

  switch (action) {
    case '开始处理': {
      if (current !== '待处理') {
        return fail(`当前为「${current}」，只有「待处理」记录才能开始处理`)
      }
      if (!isKnownDisease(input.diseaseType)) {
        return fail('病害类型缺失或不在目录内，请先补登病害类型再开始处理')
      }
      return { ok: true, status: '处理中', pending: true, abnormal: false, message: '已开始处理' }
    }

    case '完成处理': {
      if (current !== '处理中') {
        return fail(`当前为「${current}」，只有「处理中」记录才能完成处理`)
      }
      const target = resolveFinishTarget(input.diseaseType, input.siteDecision)
      if (target === '需观察') {
        return {
          ok: true,
          status: '需观察',
          pending: true,
          abnormal: false,
          message: '已完结处理，按病害判定（或现场裁决）转入「需观察」',
        }
      }
      return {
        ok: true,
        status: '已完成',
        pending: false,
        abnormal: false,
        message: '已完成处理',
      }
    }

    case '标记观察': {
      // 现场处理优先：已完成的处理结论是终态，不能事后再拉回观察。
      if (current === '已完成' || current === '已稳定') {
        return fail(`当前为「${current}」，现场处理已经结案，不能再标记观察`)
      }
      if (current !== '处理中') {
        return fail(`当前为「${current}」，只有「处理中」记录才能标记观察`)
      }
      return {
        ok: true,
        status: '需观察',
        pending: true,
        abnormal: false,
        message: '已标记为需观察',
      }
    }

    case '确认稳定': {
      if (current !== '需观察') {
        return fail(`当前为「${current}」，只有「需观察」记录才能确认稳定`)
      }
      const note = input.observationNote?.trim() ?? ''
      if (!note) {
        return fail('确认稳定前必须先登记观察结论，不能从「需观察」直接跳到「已稳定」')
      }
      return {
        ok: true,
        status: '已稳定',
        pending: false,
        abnormal: false,
        message: '观察期结束，已确认稳定',
      }
    }

    case '退回处理': {
      if (current !== '需观察') {
        return fail(`当前为「${current}」，只有「需观察」记录在复查不通过时才能退回处理`)
      }
      return {
        ok: true,
        status: '处理中',
        pending: true,
        abnormal: true,
        returnedCount: returnedCount + 1,
        message: '观察复查未通过，已退回处理',
      }
    }

    default:
      return fail(`没有登记「${action}」这个现场保护动作`)
  }
}

/**
 * 某条记录当前可执行的动作：列表与详情都用它渲染按钮，
 * 避免页面把不允许的动作摆出来。
 */
export function availableConservationActions(row: {
  status: string
  diseaseType?: unknown
}): ConservationAction[] {
  const current = isConservationStatus(row.status)
    ? row.status
    : (CONSERVATION_STATUSES[0] as ConservationStatus)
  switch (current) {
    case '待处理':
      return isKnownDisease(row.diseaseType) ? ['开始处理'] : []
    case '处理中':
      return ['完成处理', '标记观察']
    case '需观察':
      return ['确认稳定', '退回处理']
    default:
      return []
  }
}

export type ConservationRowStatus = {
  status: ConservationStatus
  pending: boolean
  abnormal: boolean
  returnedCount: number
  diseasePriority: DiseasePriority
  availableActions: ConservationAction[]
}
