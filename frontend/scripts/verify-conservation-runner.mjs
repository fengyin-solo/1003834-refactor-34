import assert from 'node:assert'
import { rmSync } from 'node:fs'

// 用 esbuild 直接把 TS 状态机打包成 ESM，避免引入测试框架依赖。
const { build } = await import('esbuild')
await build({
  entryPoints: ['scripts/verify-conservation.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'scripts/.verify-conservation.mjs',
  logLevel: 'silent',
})

const mod = await import('./.verify-conservation.mjs')
const {
  transitionConservation, diseasePriority, suggestConservationStatus,
  decideConservation, migrateConservationRows, diseaseFromArtifactCondition,
  initialStatusForDisease, availableActions,
} = mod

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log('✓', name) }

// 1. 状态机合法路径
check('待处理 开始处理 -> 处理中', () => {
  assert.equal(transitionConservation('开始处理', '待处理').target, '处理中')
})
check('处理中 完成处理 -> 已完成', () => {
  assert.equal(transitionConservation('完成处理', '处理中').target, '已完成')
})
check('处理中 标记观察 -> 需观察', () => {
  assert.equal(transitionConservation('标记观察', '处理中').target, '需观察')
})
check('需观察 确认稳定 -> 已稳定', () => {
  assert.equal(transitionConservation('确认稳定', '需观察').target, '已稳定')
})

// 2. 线上反馈的两类越轨流转必须被拦住
check('已完成 不能再标记观察', () => {
  assert.equal(transitionConservation('标记观察', '已完成').ok, false)
})
check('已稳定 不能再标记观察', () => {
  assert.equal(transitionConservation('标记观察', '已稳定').ok, false)
})
check('需观察 不能直接完成处理', () => {
  assert.equal(transitionConservation('完成处理', '需观察').ok, false)
})
check('处理中 不能确认稳定（杜绝直接跳到已稳定）', () => {
  assert.equal(transitionConservation('确认稳定', '处理中').ok, false)
})
check('待处理 不能直接完成处理', () => {
  assert.equal(transitionConservation('完成处理', '待处理').ok, false)
})
check('未登记动作被拒绝', () => {
  assert.equal(transitionConservation('删除', '处理中').ok, false)
})
check('已完成/已稳定 无可用动作', () => {
  assert.deepEqual(availableActions('已完成'), [])
  assert.deepEqual(availableActions('已稳定'), [])
})

// 3. 病害优先级判定
check('酥粉为高优先级', () => assert.equal(diseasePriority('胎体酥粉').priority, '高'))
check('病害待判定为高优先级', () => assert.equal(diseasePriority('病害待判定').priority, '高'))
check('历史遗留病害为中优先级', () => assert.equal(diseasePriority('历史遗留病害').priority, '中'))
check('裂隙为中优先级', () => assert.equal(diseasePriority('残损裂隙').priority, '中'))
check('沉积为低优先级', () => assert.equal(diseasePriority('表面沉积').priority, '低'))
check('未知病害默认中优先级', () => assert.equal(diseasePriority('某种新病害').priority, '中'))

// 4. 现场处理优先于自动建议
const base = (status, 病害类型) => ({ id: 1, status, pending: true, abnormal: false, 病害类型 })
check('处理中+高病害 自动建议需观察', () => {
  assert.equal(suggestConservationStatus(base('处理中', '胎体酥粉')), '需观察')
})
check('已完成+高病害 不给建议（现场终局锁定）', () => {
  assert.equal(suggestConservationStatus(base('已完成', '胎体酥粉')), null)
})
check('已稳定+高病害 不给建议', () => {
  assert.equal(suggestConservationStatus(base('已稳定', '胎体酥粉')), null)
})
check('处理中+低病害 不给观察建议', () => {
  assert.equal(suggestConservationStatus(base('处理中', '表面沉积')), null)
})
check('decideConservation 同时给出动作/建议/锁定标记', () => {
  const d = decideConservation(base('处理中', '胎体酥粉'))
  assert.deepEqual([...d.allowedActions].sort(), ['完成处理', '标记观察'])
  assert.equal(d.suggestion, '需观察')
  assert.equal(d.manualLocked, false)
  const locked = decideConservation(base('已完成', '胎体酥粉'))
  assert.equal(locked.manualLocked, true)
  assert.equal(locked.allowedActions.length, 0)
})

// 5. 遗物完残程度 -> 病害类型
check('完整器不产生回写', () => assert.equal(diseaseFromArtifactCondition('完整'), null))
check('严重残损 -> 酥粉碎裂（高优先级，需观察起步）', () => {
  assert.equal(diseaseFromArtifactCondition('严重残损'), '酥粉碎裂')
  assert.equal(initialStatusForDisease('酥粉碎裂'), '需观察')
})
check('残缺 -> 残损裂隙（中优先级，待处理起步）', () => {
  assert.equal(diseaseFromArtifactCondition('残缺'), '残损裂隙')
  assert.equal(initialStatusForDisease('残损裂隙'), '待处理')
})

// 6. 历史记录迁移：按处理日期补病害类型，且幂等
const legacy = { id: 6, status: '已完成', pending: false, abnormal: false, 处理日期: '2026-08-20' }
const recent = { id: 7, status: '处理中', pending: true, abnormal: false, 处理日期: '2026-09-09' }
const nodate = { id: 8, status: '待处理', pending: true, abnormal: false }
check('基准日前缺病害 -> 历史遗留病害', () => {
  assert.equal(migrateConservationRows([legacy])[0].病害类型, '历史遗留病害')
})
check('基准日后缺病害 -> 病害待判定', () => {
  assert.equal(migrateConservationRows([recent])[0].病害类型, '病害待判定')
})
check('无处理日期 -> 病害待判定', () => {
  assert.equal(migrateConservationRows([nodate])[0].病害类型, '病害待判定')
})
check('迁移幂等：再跑一次不产生变化', () => {
  const once = migrateConservationRows([legacy, recent])
  const twice = migrateConservationRows(once)
  assert.deepEqual(twice, once)
})
check('已有病害类型不被迁移覆盖', () => {
  const row = { id: 9, status: '处理中', pending: true, abnormal: false, 病害类型: '点状锈蚀', 处理日期: '2026-08-01' }
  assert.equal(migrateConservationRows([row])[0].病害类型, '点状锈蚀')
})

rmSync('scripts/.verify-conservation.mjs')
console.log(`\n全部 ${passed} 项校验通过`)
