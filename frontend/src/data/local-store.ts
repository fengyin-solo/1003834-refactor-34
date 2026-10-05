import { SEED_ROWS } from './seed'
import { migrateConservationRows } from '@/domain/conservation'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 历史数据补齐：缺病害类型的现场保护记录按处理日期迁移，幂等，重复执行不会再改第二次。
function applyMigrations(
  data: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  if (!data.conservation) {
    return data
  }
  const migrated = migrateConservationRows(data.conservation)
  const changed = migrated.some(
    (row, index) => row.病害类型 !== data.conservation[index]?.病害类型,
  )
  return changed ? { ...data, conservation: migrated } : data
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = applyMigrations(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = applyMigrations(JSON.parse(raw) as Record<string, EntryRow[]>)
    // 补齐了历史病害类型就落盘，迁移只发生一次，之后全部命中幂等分支。
    persist(parsed)
    return parsed
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitRows([[key, rows]])
}

// 跨业务回写的唯一提交口：先在内存里拼好整份数据，全部成功后一次性落盘，
// 任一步骤在调用方校验失败就不进来；即使写存储出错，内存也不会留下「只改了一半」的状态。
export function commitRows(changes: Array<[string, EntryRow[]]>): void {
  const next = { ...allRows() }
  for (const [key, rows] of changes) {
    next[key] = rows
  }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = applyMigrations({ [key]: clone(SEED_ROWS[key] ?? []) })[key] ?? []
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
