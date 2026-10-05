import { MIGRATIONS, type MigrationRecord } from './migrations'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 结构带版本号：旧结构读取时按迁移管线升级，升级成功后一次性落盘。
const STORAGE_KEY = 'field-archaeology-digital:entries'
const CURRENT_VERSION = 2

export type StoredData = {
  version: number
  entries: Record<string, EntryRow[]>
  migrations: MigrationRecord[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 种子数据保持「旧版本」原样（含缺少病害类型的历史记录），
// 由迁移管线负责升级，保证迁移路径每次都能走到。
function seedV1(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function persist(data: StoredData): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function upgrade(
  entries: Record<string, EntryRow[]>,
  fromVersion: number,
): StoredData {
  let next = entries
  const applied: MigrationRecord[] = []
  for (const step of MIGRATIONS) {
    if (step.version <= fromVersion) {
      continue
    }
    const result = step.run(next)
    next = result.entries
    applied.push({ id: step.id, changed: result.changed, note: result.note })
  }
  return { version: CURRENT_VERSION, entries: next, migrations: applied }
}

function readStorage(): StoredData {
  const fresh = seedV1()
  if (typeof window === 'undefined' || !window.localStorage) {
    return upgrade(fresh, 1)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const data = upgrade(fresh, 1)
    persist(data)
    return data
  }
  try {
    const parsed = JSON.parse(raw) as StoredData | Record<string, EntryRow[]>
    // v1 结构是裸的 entries 映射；v2 起带 version 包裹。
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
      const merged = { ...fresh, ...(parsed as Record<string, EntryRow[]>) }
      const data = upgrade(merged, 1)
      persist(data)
      return data
    }
    const stored = parsed as StoredData
    const fromVersion = Number(stored.version) || 1
    if (fromVersion < CURRENT_VERSION) {
      const data = upgrade({ ...fresh, ...stored.entries }, fromVersion)
      persist(data)
      return data
    }
    return {
      version: CURRENT_VERSION,
      entries: { ...fresh, ...stored.entries },
      migrations: Array.isArray(stored.migrations) ? stored.migrations : [],
    }
  } catch {
    const data = upgrade(fresh, 1)
    persist(data)
    return data
  }
}

let cache: StoredData | null = null

function ensureCache(): StoredData {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return ensureCache().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/**
 * 原子提交：一次事务内改多个模块，任何一步抛错或落盘失败都整体回滚，
 * 不能只更新一个页面所属模块而留下半成品。
 * producer 只能基于入参草稿做修改，返回需要落库的整份 entries。
 */
export function commitEntries(
  producer: (draft: Record<string, EntryRow[]>) => Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  const snapshot = ensureCache()
  const rollbackEntries = snapshot.entries
  let draftEntries: Record<string, EntryRow[]>
  try {
    draftEntries = producer(clone(rollbackEntries))
  } catch (error) {
    cache = snapshot
    throw error instanceof Error ? error : new Error('数据组装失败，已放弃本次操作')
  }
  const next: StoredData = {
    version: CURRENT_VERSION,
    entries: draftEntries,
    migrations: snapshot.migrations,
  }
  try {
    persist(next)
  } catch (error) {
    // 落盘失败：内存缓存也回退到事务前，避免内存与存储不一致。
    cache = snapshot
    throw error instanceof Error ? error : new Error('数据落盘失败，已回滚本次操作')
  }
  cache = next
  return next.entries
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitEntries((draft) => {
    draft[key] = rows
    return draft
  })
}

export function resetRows(key: string): EntryRow[] {
  // 重置为种子后也要过一遍迁移，保证重置出来的数据符合当前结构。
  const migrated = upgrade({ [key]: clone(SEED_ROWS[key] ?? []) }, 1)
  commitEntries((draft) => {
    draft[key] = migrated.entries[key]
    return draft
  })
  return migrated.entries[key]
}

export function appliedMigrations(): MigrationRecord[] {
  return ensureCache().migrations
}

/** 仅供 node 冒烟测试：清空内存缓存，下次读取重新走首启与迁移。 */
export function __resetCacheForTest(): void {
  cache = null
}

export function storageKey(): string {
  return STORAGE_KEY
}
