// 冒烟测试入口：仅给 scripts 下的 node 测试用，不参与应用打包。
export {
  CONSERVATION_KEY,
  MIGRATION_BACKFILL_DISEASE,
  migrateConservationLegacy,
} from '@/domain/conservation/migration'
export {
  availableConservationActions,
  diseasePriority,
  LEGACY_DISEASE_TYPE,
  resolveFinishTarget,
  transitionConservation,
} from '@/domain/conservation'
export {
  dispatchArtifactToConservation,
  executeConservationAction,
  getConservation,
  listConservation,
} from '@/api/conservation-service'

import { __resetCacheForTest, allRows, commitEntries, listRows, storageKey } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

export { commitEntries, listRows }

/** 清掉持久化与内存缓存，下次读取重新走首启与迁移。 */
export function resetStorage(): void {
  const g = globalThis as unknown as {
    window?: { localStorage?: { removeItem: (k: string) => void } }
  }
  g.window?.localStorage?.removeItem(storageKey())
  __resetCacheForTest()
}

/** 触发首启读取（含迁移落盘）。 */
export function bootstrap(): Record<string, EntryRow[]> {
  return allRows()
}

export function getArtifactRow(id: number): EntryRow {
  const row = allRows()['artifact']?.find((item) => Number(item.id) === id)
  if (!row) {
    throw new Error(`artifact ${id} not found`)
  }
  return row
}
