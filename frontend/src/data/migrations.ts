import type { EntryRow } from './types'
import {
  MIGRATION_BACKFILL_DISEASE,
  migrateConservationLegacy,
} from '@/domain/conservation/migration'

export type MigrationRecord = {
  id: string
  changed: number
  note: string
}

export type MigrationStep = {
  /** 迁移成功后的存储版本号。 */
  version: number
  id: string
  run: (entries: Record<string, EntryRow[]>) => {
    entries: Record<string, EntryRow[]>
    changed: number
    note: string
  }
}

// 存储结构演进管线：fromVersion 依次往后跑，顺序就是历史顺序，禁止插队改写。
export const MIGRATIONS: MigrationStep[] = [
  { version: 2, id: MIGRATION_BACKFILL_DISEASE, run: migrateConservationLegacy },
]
