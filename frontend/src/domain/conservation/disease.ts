// 现场保护领域：病害类型目录与优先级判定。
// 列表、详情、跨业务回写都只准用这里的结论，不允许各自再写一遍判断。

export type DiseasePriority = '高' | '中' | '低'
export type DiseaseSuggestion = '需观察' | '可完成'

export type DiseaseEntry = {
  type: string
  priority: DiseasePriority
  /** 高、中优先级病害处理完后自动建议进入观察，低优先级直接可完结。 */
  suggestion: DiseaseSuggestion
}

// 田野文物现场常见病害的分级目录：高优先级病害极易复发，必须留观复查。
export const DISEASE_CATALOG: DiseaseEntry[] = [
  { type: '风化', priority: '高', suggestion: '需观察' },
  { type: '裂隙', priority: '高', suggestion: '需观察' },
  { type: '起翘', priority: '高', suggestion: '需观察' },
  { type: '霉变', priority: '中', suggestion: '需观察' },
  { type: '盐析', priority: '中', suggestion: '需观察' },
  { type: '彩绘剥落', priority: '中', suggestion: '需观察' },
  { type: '金属锈蚀', priority: '中', suggestion: '需观察' },
  { type: '酥粉', priority: '中', suggestion: '需观察' },
  { type: '污渍', priority: '低', suggestion: '可完成' },
  { type: '附着物', priority: '低', suggestion: '可完成' },
  { type: '残缺', priority: '低', suggestion: '可完成' },
  { type: '变色', priority: '低', suggestion: '可完成' },
]

// 历史记录迁移时，对缺少病害类型的旧记录补填的兜底类型：低优先级，不改变其完结结论。
// 它能被状态机识别（迁移后的旧记录可以继续流转），但不属于新建时可选的病害目录。
export const LEGACY_DISEASE_TYPE = '未分型（历史数据）'

const CATALOG_BY_TYPE: Map<string, DiseaseEntry> = new Map([
  ...DISEASE_CATALOG.map((item) => [item.type, item] as const),
  [LEGACY_DISEASE_TYPE, { type: LEGACY_DISEASE_TYPE, priority: '低', suggestion: '可完成' }],
])

// 新建记录可选的病害类型：不含历史迁移兜底类型。
export const SELECTABLE_DISEASE_TYPES: string[] = DISEASE_CATALOG.map((item) => item.type)

export function isKnownDisease(type: unknown): type is string {
  return typeof type === 'string' && CATALOG_BY_TYPE.has(type.trim())
}

/** 取病害优先级；目录外（含迁移兜底类型）一律按低优先级处理。 */
export function diseasePriority(type: unknown): DiseasePriority {
  if (isKnownDisease(type)) {
    return CATALOG_BY_TYPE.get(type.trim())!.priority
  }
  return '低'
}

/** 系统基于病害给出的自动处置建议。 */
export function diseaseSuggestion(type: unknown): DiseaseSuggestion {
  if (isKnownDisease(type)) {
    return CATALOG_BY_TYPE.get(type.trim())!.suggestion
  }
  return '可完成'
}

/** 现场处理优先于自动建议：显式裁决非空时一律以现场为准。 */
export function resolveFinishTarget(
  type: unknown,
  siteDecision?: '需观察' | '已完成' | '',
): '需观察' | '已完成' {
  if (siteDecision === '需观察' || siteDecision === '已完成') {
    return siteDecision
  }
  return diseaseSuggestion(type) === '需观察' ? '需观察' : '已完成'
}
