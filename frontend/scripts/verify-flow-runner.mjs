import assert from 'node:assert'
import { rmSync } from 'node:fs'

// 端到端：内存 localStorage + 真实数据层/服务层，验证迁移、动作拦截与跨模块回写。
const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
}

const { build } = await import('esbuild')
await build({
  entryPoints: ['scripts/verify-flow.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'scripts/.verify-flow.mjs',
  logLevel: 'silent',
})

const { getEntry, listEntries, runAction, allRows, resetRows, storageKey, decideConservation } =
  await import('./.verify-flow.mjs')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log('✓', name) }

// 1. 首次读取即迁移历史记录（种子里 6/7 两条缺病害类型）
const migrated = allRows().conservation
check('CONS-0006（2026-08-20 老记录）补为历史遗留病害', () => {
  const row = migrated.find((r) => r.id === 6)
  assert.equal(row.病害类型, '历史遗留病害')
})
check('CONS-0007（2026-09-09 新记录）补为病害待判定', () => {
  const row = migrated.find((r) => r.id === 7)
  assert.equal(row.病害类型, '病害待判定')
})
check('迁移结果已落盘，且再次读取保持幂等', () => {
  const raw = JSON.parse(storage.get(storageKey()))
  assert.equal(raw.conservation.find((r) => r.id === 6).病害类型, '历史遗留病害')
})

// 2. 列表/服务层动作拦截：已完成记录不能标记观察
check('已完成 CONS-0005 标记观察被拒绝', () => {
  const result = runAction('conservation', 5, '标记观察')
  assert.equal(result.ok, false)
  assert.match(result.message, /不能标记观察/)
})
check('CONS-0004 需观察 直接完成处理被拒绝（不能越级）', () => {
  const result = runAction('conservation', 4, '完成处理')
  assert.equal(result.ok, false)
})
check('CONS-0004 需观察 确认稳定成功', () => {
  const result = runAction('conservation', 4, '确认稳定')
  assert.equal(result.ok, true)
  assert.equal(getEntry('conservation', 4).status, '已稳定')
})
check('CONS-0003 处理中 标记观察成功（状态机统一入口）', () => {
  const result = runAction('conservation', 3, '标记观察')
  assert.equal(result.ok, true)
  assert.equal(getEntry('conservation', 3).status, '需观察')
})
check('CONS-0002 待处理+酥粉高优先级，列表裁决给出需观察建议但不自动改状态', () => {
  const row = getEntry('conservation', 2)
  const d = decideConservation(row)
  assert.equal(d.priority, '高')
  assert.equal(d.suggestion, '需观察')
  assert.equal(row.status, '待处理')
})

// 3. 遗物入库回写
// ARTI-0001 完整 -> 仅入库不回写
check('ARTI-0001 完整器入库：不产生保护回写', () => {
  const before = allRows().conservation.length
  const result = runAction('artifact', 1, '办理入库')
  assert.equal(result.ok, true)
  assert.match(result.message, /无需现场保护回写/)
  assert.equal(allRows().conservation.length, before)
  assert.equal(getEntry('artifact', 1).status, '已入库')
})

// ARTI-0003 残缺（中优先级，无关联保护记录）-> 新建待处理保护记录，单次提交
check('ARTI-0003 残缺入库：新建残损裂隙保护记录（待处理起步）', () => {
  const before = allRows().conservation.length
  const result = runAction('artifact', 3, '办理入库')
  assert.equal(result.ok, true)
  const conservation = allRows().conservation
  assert.equal(conservation.length, before + 1)
  const created = conservation.find((r) => r.保护对象 === 'ARTI-0003')
  assert.ok(created)
  assert.equal(created.病害类型, '残损裂隙')
  assert.equal(created.status, '待处理')
  assert.equal(getEntry('artifact', 3).status, '已入库')
})

// ARTI-0002 严重残损，但 CONS-0005 已被现场完成 -> 现场裁决优先，建议不覆盖
check('ARTI-0002 入库：关联保护记录已完成，自动建议不覆盖现场裁决', () => {
  const result = runAction('artifact', 2, '办理入库')
  assert.equal(result.ok, true)
  assert.match(result.message, /现场终局|现场裁决/)
  const linked = getEntry('conservation', 5)
  assert.equal(linked.status, '已完成')
  assert.equal(getEntry('artifact', 2).status, '已入库')
})

// 4. 原子性：非法动作（重复入库）必须整体不动，不留半成品
check('重复办理入库被拒绝，两模块数据均不变', () => {
  const snapshot = JSON.stringify(allRows())
  const result = runAction('artifact', 1, '办理入库')
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(allRows()), snapshot)
})

// 5. 重置后迁移仍会自动补齐
check('重置现场保护模块后，缺病害历史记录仍被迁移补齐', () => {
  resetRows('conservation')
  const rows = listEntries('conservation').items
  assert.equal(rows.find((r) => r.id === 6).病害类型, '历史遗留病害')
  assert.equal(rows.find((r) => r.id === 7).病害类型, '病害待判定')
})

rmSync('scripts/.verify-flow.mjs')
console.log(`\n全部 ${passed} 项端到端校验通过`)
