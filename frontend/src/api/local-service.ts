import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, commitRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  CONSERVATION_KEY,
  diseaseFromArtifactCondition,
  decideConservation,
  initialStatusForDisease,
  isPendingStatus,
  transitionConservation,
} from '@/domain/conservation'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

// 现场保护动作：唯一入口是共用状态机，列表、详情、回写都不允许绕过。
function runConservationAction(id: number, action: string): ActionResult {
  const rows = listRows(CONSERVATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的保护处理记录` }
  }
  const current = rows[index]
  const verdict = transitionConservation(action, String(current.status))
  if (!verdict.ok || !verdict.target) {
    return { ok: false, message: verdict.reason ?? '现场保护状态机拒绝了该操作' }
  }
  const target = verdict.target
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: isPendingStatus(target),
    abnormal: false,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(CONSERVATION_KEY, next)
  return { ok: true, message: `保护处理记录已${action}，当前状态「${target}」` }
}

// 出土遗物「办理入库」的跨业务回写：同一份现场保护状态机裁决，单次提交落库。
// 遗物状态与保护记录要么一起更新，要么都不动，绝不允许只改一个页面留下半成品。
function runArtifactAction(id: number, action: string): ActionResult {
  const meta = MODULE_BY_KEY.get('artifact')!
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const artifactRows = listRows('artifact')
  const artifactIndex = artifactRows.findIndex((row) => Number(row.id) === id)
  if (artifactIndex < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的出土遗物` }
  }
  const artifact = artifactRows[artifactIndex]
  if (String(artifact.status) === target) {
    return { ok: false, message: `出土遗物已经是「${target}」，不用重复操作` }
  }

  const updatedArtifact: EntryRow = {
    ...artifact,
    status: target,
    pending: target !== meta.statuses[meta.statuses.length - 1],
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const nextArtifacts = [...artifactRows]
  nextArtifacts[artifactIndex] = updatedArtifact

  // 只有「办理入库」才向现场保护回写；其余动作只更新遗物本身。
  if (action !== '办理入库') {
    commitRows([['artifact', nextArtifacts]])
    return { ok: true, message: `出土遗物已${action}，当前状态「${target}」` }
  }

  const diseaseType = diseaseFromArtifactCondition(String(artifact.完残程度 ?? ''))
  if (!diseaseType) {
    commitRows([['artifact', nextArtifacts]])
    return { ok: true, message: `出土遗物已${action}，完残程度为完整器，无需现场保护回写` }
  }

  const conservationRows = listRows(CONSERVATION_KEY)
  const linkedIndex = conservationRows.findIndex(
    (row) => String(row.保护对象) === String(artifact.器物编号),
  )
  const nextConservation = [...conservationRows]

  let note: string
  if (linkedIndex >= 0) {
    const linked = conservationRows[linkedIndex]
    const decision = decideConservation(linked)
    // 现场处理优先于自动建议：已完成/已稳定的记录，入库回写只能提示不能改写。
    if (decision.manualLocked) {
      note = `关联保护记录已是现场终局「${decision.status}」，自动观察建议不覆盖现场裁决`
    } else {
      const suggested = decision.suggestion
      if (suggested && String(linked.status) !== suggested) {
        nextConservation[linkedIndex] = {
          ...linked,
          status: suggested,
          pending: isPendingStatus(suggested),
          abnormal: false,
        }
        note = `已按${decision.priority}优先级病害把关联保护记录回写为「${suggested}」`
      } else {
        note = `关联保护记录已处于「${linked.status}」，无需重复回写`
      }
    }
  } else {
    const status = initialStatusForDisease(diseaseType)
    const newId = conservationRows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
    const created: EntryRow = {
      id: newId,
      status,
      pending: isPendingStatus(status),
      abnormal: false,
      处理编号: `CONS-RW-${String(newId).padStart(4, '0')}`,
      保护对象: String(artifact.器物编号),
      病害类型: diseaseType,
      处理材料: '待评估',
      处理方法: '入库回写自动登记',
      处理日期: new Date().toISOString().slice(0, 10),
      操作人: '系统回写',
      处理状态: status,
    }
    nextConservation.push(created)
    note = `已按病害类型「${diseaseType}」新建保护处理记录，起始状态「${status}」`
  }

  // 两份数据在同一事务边界内一次提交：校验失败时上面已直接返回，不会走到这里。
  commitRows([
    ['artifact', nextArtifacts],
    [CONSERVATION_KEY, nextConservation],
  ])
  return { ok: true, message: `出土遗物已${action}；${note}` }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === CONSERVATION_KEY) {
    return runConservationAction(id, action)
  }
  if (key === 'artifact') {
    return runArtifactAction(id, action)
  }

  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
