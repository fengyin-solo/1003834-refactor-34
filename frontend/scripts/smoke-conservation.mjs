// 现场保护重构冒烟测试：跑状态机、迁移、跨业务原子写，不进浏览器。
// 用法：node scripts/smoke-conservation.mjs（由 esbuild 先打包 test 入口）
import assert from 'node:assert/strict'

const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  },
}

const mod = await import('./smoke-bundle.mjs')
const {
  transitionConservation,
  availableConservationActions,
  resolveFinishTarget,
  diseasePriority,
  LEGACY_DISEASE_TYPE,
  migrateConservationLegacy,
  CONSERVATION_KEY,
  bootstrap,
  dispatchArtifactToConservation,
  executeConservationAction,
  listConservation,
  getConservation,
  resetStorage,
} = mod

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('病害优先级与自动建议')
check('高优先级病害（风化）建议观察', () => {
  assert.equal(resolveFinishTarget('风化'), '需观察')
  assert.equal(diseasePriority('裂隙'), '高')
})
check('低优先级病害（污渍）可直接完结', () => {
  assert.equal(resolveFinishTarget('污渍'), '已完成')
  assert.equal(diseasePriority('污渍'), '低')
})
check('现场裁决优先于自动建议：风化也可现场直接完成', () => {
  assert.equal(resolveFinishTarget('风化', '已完成'), '已完成')
})
check('现场裁决优先：污渍也可现场要求观察', () => {
  assert.equal(resolveFinishTarget('污渍', '需观察'), '需观察')
})

console.log('状态机：修掉两个旧问题')
check('已完成不能再标记观察', () => {
  const r = transitionConservation('标记观察', { status: '已完成', diseaseType: '风化' })
  assert.equal(r.ok, false)
})
check('已稳定不能再标记观察', () => {
  const r = transitionConservation('标记观察', { status: '已稳定', diseaseType: '风化' })
  assert.equal(r.ok, false)
})
check('需观察不能无结论直接确认稳定', () => {
  const r = transitionConservation('确认稳定', { status: '需观察', observationNote: '' })
  assert.equal(r.ok, false)
})
check('需观察登记结论后可确认稳定', () => {
  const r = transitionConservation('确认稳定', { status: '需观察', observationNote: '复查无异常' })
  assert.equal(r.ok, true)
  assert.equal(r.status, '已稳定')
})
check('处理中可标记观察', () => {
  const r = transitionConservation('标记观察', { status: '处理中' })
  assert.equal(r.ok, true)
  assert.equal(r.status, '需观察')
})
check('待处理缺病害类型不能开始处理', () => {
  const r = transitionConservation('开始处理', { status: '待处理', diseaseType: '' })
  assert.equal(r.ok, false)
})
check('待处理有病害类型可以开始处理', () => {
  const r = transitionConservation('开始处理', { status: '待处理', diseaseType: '霉变' })
  assert.equal(r.ok, true)
})
check('完成处理：高优先级自动转需观察', () => {
  const r = transitionConservation('完成处理', { status: '处理中', diseaseType: '霉变' })
  assert.equal(r.status, '需观察')
})
check('完成处理：现场裁决覆盖自动建议', () => {
  const r = transitionConservation('完成处理', { status: '处理中', diseaseType: '霉变', siteDecision: '已完成' })
  assert.equal(r.status, '已完成')
})
check('退回处理：只有需观察可退回，累加次数并标异常', () => {
  const r = transitionConservation('退回处理', { status: '需观察', returnedCount: 1 })
  assert.equal(r.ok, true)
  assert.equal(r.status, '处理中')
  assert.equal(r.abnormal, true)
  assert.equal(r.returnedCount, 2)
})
check('终态记录无可执行动作', () => {
  assert.deepEqual(availableConservationActions({ status: '已完成', diseaseType: '风化' }), [])
})

console.log('历史迁移：按处理日期升序补填')
{
  const entries = {
    [CONSERVATION_KEY]: [
      { id: 2, status: '处理中', pending: true, abnormal: false, '病害类型': '   ', '处理日期': '2026-08-24' },
      { id: 3, status: '已稳定', pending: true, abnormal: false, '病害类型': '裂隙', '处理日期': '2026-09-01' },
      { id: 1, status: '待处理', pending: true, abnormal: false, '处理日期': '2026-08-20' },
    ],
  }
  check('仅缺失行被补填，顺序按处理日期', () => {
    const { entries: next, changed } = migrateConservationLegacy(entries)
    const rows = next[CONSERVATION_KEY]
    assert.equal(changed, 2)
    assert.equal(rows.find((r) => r.id === 1)['病害类型'], LEGACY_DISEASE_TYPE)
    assert.equal(rows.find((r) => r.id === 2)['病害类型'], LEGACY_DISEASE_TYPE)
    assert.match(rows.find((r) => r.id === 1)['迁移说明'], /第 1 条/)
    assert.match(rows.find((r) => r.id === 2)['迁移说明'], /第 2 条/)
    assert.equal(rows.find((r) => r.id === 3)['病害类型'], '裂隙')
    assert.equal(rows.find((r) => r.id === 3)['迁移说明'], undefined)
  })
  check('迁移幂等：再跑一次不产生新改动', () => {
    const once = migrateConservationLegacy(entries).entries
    const twice = migrateConservationLegacy(once)
    assert.equal(twice.changed, 0)
    assert.equal(twice.entries[CONSERVATION_KEY].find((r) => r.id === 1)['病害类型'], LEGACY_DISEASE_TYPE)
  })
  check('迁移按状态机校准 pending', () => {
    const { entries: next } = migrateConservationLegacy(entries)
    assert.equal(next[CONSERVATION_KEY].find((r) => r.id === 3).pending, false)
  })
}

console.log('存储启动迁移（种子即 v1 旧数据）')
resetStorage()
const started = bootstrap()
check('种子里两条缺病害类型的旧记录被补填', () => {
  const c6 = getConservation(6)
  const c7 = getConservation(7)
  assert.equal(c6['病害类型'], LEGACY_DISEASE_TYPE)
  assert.equal(c7['病害类型'], LEGACY_DISEASE_TYPE)
  assert.match(String(c6['迁移说明']), /第 1 条/)
  assert.match(String(c7['迁移说明']), /第 2 条/)
})
check('CONS-0003 迁移后仍是需观察且可执行确认稳定/退回', () => {
  const c3 = getConservation(3)
  assert.equal(c3.status, '需观察')
  assert.ok(c3.availableActions.includes('确认稳定'))
  assert.ok(c3.availableActions.includes('退回处理'))
})
check('已完成的 CONS-0004 没有任何动作（不能再观察）', () => {
  assert.deepEqual(getConservation(4).availableActions, [])
})

console.log('列表服务：动作与统计走状态机')
check('列表视图带优先级与可执行动作', () => {
  const rows = listConservation({})
  const c2 = rows.find((r) => r.id === 2)
  assert.equal(c2.diseasePriorityLabel, '中')
  assert.deepEqual(c2.availableActions, ['完成处理', '标记观察'])
})

console.log('跨业务：遗物送现场保护，原子回写')
check('送护成功：新处理单为处理中，遗物保护回写同步', () => {
  const before = getConservation(8)
  assert.equal(before, null)
  const r = dispatchArtifactToConservation(1, { diseaseType: '酥粉', operator: '测试员' })
  assert.equal(r.ok, true)
  const created = getConservation(r.conservationId)
  assert.equal(created.status, '处理中')
  assert.equal(created['关联遗物'], 'ARTI-0001')
  const linked = mod.getArtifactRow(1)
  assert.match(String(linked['保护回写']), /处理中$/)
})
check('重复送护被拒绝（有未结案处理单）', () => {
  const r = dispatchArtifactToConservation(1, { diseaseType: '酥粉', operator: '测试员' })
  assert.equal(r.ok, false)
})
check('非法病害送护被同一状态机拒绝，遗物回写不动', () => {
  const beforeWrite = String(mod.getArtifactRow(3)['保护回写'] ?? '')
  const r = dispatchArtifactToConservation(3, { diseaseType: '不存在的病害', operator: '测试员' })
  assert.equal(r.ok, false)
  assert.equal(String(mod.getArtifactRow(3)['保护回写'] ?? ''), beforeWrite)
})

console.log('跨业务回写：保护动作与遗物回写同一事务')
check('CONS-0003 确认稳定后遗物 ARTI-0002 回写为已稳定', () => {
  const r = executeConservationAction(3, '确认稳定', { observationNote: '复查漆面稳定' })
  assert.equal(r.ok, true)
  assert.equal(getConservation(3).status, '已稳定')
  assert.match(String(mod.getArtifactRow(2)['保护回写']), /已稳定$/)
})
check('CONS-0003 缺观察结论被状态机拒绝，两边数据都不动', () => {
  resetStorage()
  bootstrap()
  const beforeStatus = getConservation(3).status
  const beforeWrite = String(mod.getArtifactRow(2)['保护回写'])
  const r = executeConservationAction(3, '确认稳定', { observationNote: '   ' })
  assert.equal(r.ok, false)
  assert.equal(getConservation(3).status, beforeStatus)
  assert.equal(String(mod.getArtifactRow(2)['保护回写']), beforeWrite)
})
check('退回处理同事务回写遗物为处理中并保留半成品防线', () => {
  const r = executeConservationAction(3, '退回处理', { observationNote: '边缘复翘' })
  assert.equal(r.ok, true)
  assert.equal(getConservation(3).status, '处理中')
  assert.equal(getConservation(3).abnormal, true)
  assert.match(String(mod.getArtifactRow(2)['保护回写']), /处理中$/)
})

console.log(`\n全部 ${passed} 项冒烟检查通过`)

// ---- 追加：事务内失败注入，验证原子回滚 ----
console.log('原子提交：事务内失败整体回滚')
{
  const { commitEntries, listRows } = mod
  const beforeConservation = JSON.stringify(listRows('conservation'))
  const beforeArtifact = JSON.stringify(listRows('artifact'))
  let threw = false
  try {
    commitEntries((draft) => {
      draft['conservation'] = [
        ...draft['conservation'],
        { id: 999, status: '处理中', pending: true, abnormal: false, '处理编号': 'CONS-0999' },
      ]
      // 模拟跨业务写遗物时失败
      throw new Error('遗物回写失败（注入）')
    })
  } catch (error) {
    threw = true
    assert.match(String(error), /遗物回写失败/)
  }
  check('事务抛错且两个模块均无改动', () => {
    assert.equal(threw, true)
    assert.equal(JSON.stringify(listRows('conservation')), beforeConservation)
    assert.equal(JSON.stringify(listRows('artifact')), beforeArtifact)
  })
  console.log(`\n含失败注入共 ${passed} 项冒烟检查通过`)
}
