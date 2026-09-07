const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { defaultAcceptPaths } = require('../accept/accept-chain')
const { buildStatus, gateStage, loadState, refuseAgentMark, runStage, workflowPath } = require('./tracking-workflow')
const { DEVICE_PROMPT } = require('../accept/accept-device')
const {
  ASK_HISTORY_EXCEL,
  D_FAIL_CHOICE,
  DELETE_OLD_TRACKING,
  ENTRY_MENU,
  formatDeleteOldTracking
} = require('./prompts')
const { readJson, writeJson } = require('../lib/lib')
const { D_FAIL_CHOICE: FAIL_FROM_FORMAT } = require('../accept/format-fail-explain')

function makeDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeFile(filePath, content) {
  makeDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content)
}

function baseFixture(name, opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bella-workflow-'))
  const docsDir = makeDir(path.join(root, 'docs'))
  const excelPath = path.join(docsDir, `${name}.xlsx`)
  writeFile(excelPath, 'excel')
  const paths = defaultAcceptPaths(root, { excel: excelPath })
  makeDir(path.dirname(paths.eventsPath))
  makeDir(path.dirname(paths.implPath))
  makeDir(path.join(paths.outDir, '_raw', 'images'))
  writeFile(paths.htmlPath, '<html></html>')
  writeJson(paths.eventsPath, {
    slug: name,
    excelPath,
    sheetName: 'Sheet1',
    events: (opts.events || []).map((item, idx) => Object.assign({
      evtId: String(item.evtId),
      docIndex: idx + 1,
      eventName: item.eventName || `event-${idx + 1}`,
      kind: item.kind || 'click',
      eventType: item.eventType || 'click',
      pid: item.pid || 'pid'
    }, item))
  })
  writeJson(paths.implPath, {
    events: (opts.implEvents || []).map((item, idx) => Object.assign({
      evtId: String(item.evtId),
      docIndex: idx + 1
    }, item))
  })
  writeJson(paths.adaptorPath, {
    sdkId: '$ULOG',
    styles: [],
    sourceRoots: []
  })
  ;((opts.events || [])).forEach(item => {
    writeFile(path.join(paths.outDir, '_raw', 'images', `${String(item.evtId)}.png`), 'png')
  })
  if (opts.workflow) {
    writeJson(path.join(paths.outDir, '_raw', 'workflow.json'), opts.workflow)
  }
  if (opts.acceptReport) {
    makeDir(path.dirname(paths.acceptJson))
    writeJson(paths.acceptJson, opts.acceptReport)
  }
  return { root, paths, excelPath }
}

function getNextTask(result) {
  return result.nextTask || result.taskResult && result.taskResult.nextTask || null
}

function entered(fixture, extra) {
  return Object.assign({ excel: fixture.excelPath, entry: '3' }, extra || {})
}

test('same disk facts resolve to the same nextTask', () => {
  const fixture = baseFixture('determinism', {
    events: [{ evtId: '1001', eventName: 'Pending event' }],
    implEvents: [{ evtId: '1001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const first = buildStatus(fixture.paths, entered(fixture), fixture.root)
  const second = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.deepStrictEqual(getNextTask(first), getNextTask(second))
  assert.strictEqual(getNextTask(first).id, 'A_ANALYZE_EVENT')
  assert.strictEqual(first.stageStatus.A.done, false)
})

test('dump/render done does not imply A complete when impl facts are missing', () => {
  const fixture = baseFixture('a-partial', {
    events: [{ evtId: '2001', eventName: 'Analyze me' }],
    implEvents: [{ evtId: '2001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.A.done, false)
  assert.strictEqual(getNextTask(status).stage, 'A')
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
  assert.notStrictEqual(getNextTask(status).id, 'A_COMPLETE')
})

test('needsConfirm resolves to a user confirmation task', () => {
  const fixture = baseFixture('needs-confirm', {
    events: [{ evtId: '3001', eventName: 'Need confirm' }],
    implEvents: [{
      evtId: '3001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: '', confidence: 'medium' }]
    }]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).stage, 'B')
  assert.strictEqual(getNextTask(status).executor, 'user')
  assert.strictEqual(getNextTask(status).id, 'B_CONFIRM_EVENT')
  assert.strictEqual(getNextTask(status).subject.evtId, '3001')
  assert.strictEqual(status.stageStatus.A.done, true)
  assert.ok(getNextTask(status).prompt)
  assert.match(getNextTask(status).command, /confirm-event/)
})

test('validation failure enters blocked fix-validation state', () => {
  const fixture = baseFixture('validation-fail', {
    events: [{ evtId: '4001', eventName: 'Bad impl' }],
    implEvents: [{
      evtId: '4001',
      status: 'existing',
      targetFile: 'src/foo.js',
      uicode: 'illegal',
      parameters: []
    }]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).id, 'A_VALIDATE_IMPL')
  assert.strictEqual(getNextTask(status).status, 'blocked')
  assert.match(getNextTask(status).command, /validate-impl/)
})

test('queue cleared but B not marked done requires full-page confirmation', () => {
  const fixture = baseFixture('b-gate', {
    events: [{ evtId: '5001', eventName: 'Ready for C' }],
    implEvents: [{
      evtId: '5001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
    }]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.A.done, true)
  assert.strictEqual(status.stageStatus.B.done, false)
  assert.strictEqual(getNextTask(status).id, 'B_CONFIRM_FULL_PAGE')
  assert.strictEqual(getNextTask(status).executor, 'user')
  assert.match(getNextTask(status).prompt, /进入 C/)
})

test('B done moves workflow to C, accept report completes it', () => {
  const fixture = baseFixture('completed', {
    events: [{ evtId: '6001', eventName: 'Complete' }],
    implEvents: [{
      evtId: '6001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
    }],
    workflow: {
      version: 1,
      stages: {
        B: { status: 'done', completedAt: '2026-09-03T00:00:00.000Z' },
        C: { status: 'done', completedAt: '2026-09-03T00:01:00.000Z' }
      },
      history: []
    },
    acceptReport: {
      planOnly: false,
      summary: { total: 1, pass: 1, fail: 0, skip: 0, pathBlockerSkip: 0 }
    }
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.D.done, true)
  assert.strictEqual(status.nextTask, null)
})

test('same facts twice keep nextTask including command and prompt', () => {
  const fixture = baseFixture('stable-cmd', {
    events: [{ evtId: '1001', eventName: 'Pending event' }],
    implEvents: [{ evtId: '1001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const first = buildStatus(fixture.paths, entered(fixture), fixture.root)
  const second = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.deepStrictEqual(getNextTask(first), getNextTask(second))
  assert.strictEqual(getNextTask(first).id, 'A_ANALYZE_EVENT')
  assert.strictEqual(getNextTask(first).executor, 'agent')
  assert.strictEqual(getNextTask(first).subject.evtId, '1001')
  assert.match(getNextTask(first).command, /^node scripts\/workflow\/apply-impl-patch\.js --excel=docs\/stable-cmd\.xlsx --task=A_ANALYZE_EVENT --evt=1001 --patch=-$/)
  assert.strictEqual(getNextTask(first).prompt, null)
})

test('multiple pending events pin the smallest docIndex', () => {
  const fixture = baseFixture('multi-pending', {
    events: [
      { evtId: '9002', eventName: 'Second', docIndex: 2 },
      { evtId: '9001', eventName: 'First', docIndex: 1 }
    ],
    implEvents: [
      { evtId: '9002', docIndex: 2, status: 'pending', targetFile: '', parameters: [] },
      { evtId: '9001', docIndex: 1, status: 'pending', targetFile: '', parameters: [] }
    ]
  })
  const first = buildStatus(fixture.paths, entered(fixture), fixture.root)
  const second = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(first).subject.evtId, '9001')
  assert.strictEqual(getNextTask(second).subject.evtId, '9001')
  assert.deepStrictEqual(getNextTask(first), getNextTask(second))
})

test('located events are not mixed into first pending nextTask', () => {
  const fixture = baseFixture('skip-located', {
    events: [
      { evtId: '1', eventName: 'Located' },
      { evtId: '2', eventName: 'Pending' }
    ],
    implEvents: [
      { evtId: '1', status: 'located', targetFile: 'src/a.js', parameters: [{ key: 'roomId', expression: 'x', confidence: 'high' }] },
      { evtId: '2', status: 'pending', targetFile: '', parameters: [] }
    ]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
  assert.strictEqual(getNextTask(status).subject.evtId, '2')
})

test('--run=A stub does not mark workflow A done', () => {
  const fixture = baseFixture('run-a-mark', {
    events: [{ evtId: '2001', eventName: 'Analyze me' }],
    implEvents: [{ evtId: '2001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const state = loadState(fixture.paths)
  const run = runStage(fixture.paths, { excel: fixture.excelPath }, fixture.root, state, 'A', () => {})
  assert.deepStrictEqual(run.did, ['dump-excel', 'render-html'])
  assert.ok(run.didNot.indexOf('analyze-events') !== -1)
  assert.ok(run.didNot.indexOf('complete-stage-A') !== -1)
  assert.strictEqual(run.stageAComplete, false)
  const wf = readJson(workflowPath(fixture.paths), {})
  assert.ok(!wf.stages || !wf.stages.A || wf.stages.A.status !== 'done')
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.A.done, false)
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
})

test('--mark=A does not make A.done true while pending remains', () => {
  const fixture = baseFixture('mark-a', {
    events: [{ evtId: '2101', eventName: 'Still pending' }],
    implEvents: [{ evtId: '2101', status: 'pending', targetFile: '', parameters: [] }],
    workflow: {
      version: 1,
      stages: { A: { status: 'done', completedAt: '2026-09-03T00:00:00.000Z' } },
      history: []
    }
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.A.done, false)
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
})

test('needA blocks --run=C from a write-impl command', () => {
  const fixture = baseFixture('need-a-c', {
    events: [{ evtId: '7001', eventName: 'Pending' }],
    implEvents: [{ evtId: '7001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const gate = gateStage(fixture.paths, 'C')
  assert.strictEqual(gate.exitCode, 3)
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).stage, 'A')
  assert.notStrictEqual(getNextTask(status).id, 'C_WRITE_EVENT')
  assert.notStrictEqual(getNextTask(status).id, 'C_FILL_ACCEPT')
  assert.notStrictEqual(getNextTask(status).id, 'C_BUILD_CHAIN')
  assert.ok(!/业务源码/.test(getNextTask(status).command || ''))
})

test('no device after C asks D_CHOOSE_DEVICE with original prompt', () => {
  const fixture = baseFixture('choose-device', {
    events: [{ evtId: '8001', eventName: 'Ready' }],
    implEvents: [{
      evtId: '8001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
    }],
    workflow: {
      version: 1,
      stages: {
        B: { status: 'done', completedAt: '2026-09-03T00:00:00.000Z' },
        C: { status: 'done', completedAt: '2026-09-03T00:01:00.000Z' }
      },
      history: []
    }
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).id, 'D_CHOOSE_DEVICE')
  assert.strictEqual(getNextTask(status).prompt, DEVICE_PROMPT)
})

test('analyzed + validated events never return A_ANALYZE_EVENT', () => {
  const fixture = baseFixture('a-complete', {
    events: [{ evtId: '5001', eventName: 'Ready for C' }],
    implEvents: [{
      evtId: '5001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
    }]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.A.done, true)
  assert.notStrictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
})

test('no entry and no run returns CHOOSE_ENTRY with ENTRY_MENU', () => {
  const fixture = baseFixture('need-menu', {
    events: [{ evtId: '1001', eventName: 'Pending event' }],
    implEvents: [{ evtId: '1001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const first = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  const second = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(getNextTask(first).id, 'CHOOSE_ENTRY')
  assert.strictEqual(getNextTask(first).prompt, ENTRY_MENU)
  assert.strictEqual(getNextTask(first).nextAction, 'choose_entry')
  assert.strictEqual(getNextTask(second).prompt, getNextTask(first).prompt)
})

test('--entry=3 leaves CHOOSE_ENTRY and follows A_*', () => {
  const fixture = baseFixture('entry-3', {
    events: [{ evtId: '1001', eventName: 'Pending event' }],
    implEvents: [{ evtId: '1001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath, entry: '3' }, fixture.root)
  assert.notStrictEqual(getNextTask(status).id, 'CHOOSE_ENTRY')
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
})

test('ENTRY_MENU snapshot keeps eight product options', () => {
  assert.strictEqual(ENTRY_MENU, `请选择本次入口（回复字母或序号）：
1. 验收全流程 A→B→C→D【强烈推荐】（E 仅在 D 失败且你同意后才跑）
2. 落库到写码 A→B→C
3. A 落库（只分析，不写业务源码）
4. D 关键验收
5. E 空值自修复（仅 D 失败后，或你点名 E）
6. F 历史埋点关系
7. 文档 vs 代码：缺失埋点列表
8. 补全历史缺失埋点（依赖入口 7 的缺失表；只写 missing，不改 found）`)
})

test('shared prompts stay single-sourced', () => {
  assert.strictEqual(FAIL_FROM_FORMAT, D_FAIL_CHOICE)
  assert.strictEqual(DEVICE_PROMPT, `请选择 Playwright 打开方式（回复 1 或 2）：
1. 移动端（iPhone 13）
2. PC 端（桌面视口）
未选择前不启动浏览器、不跑验收。`)
  assert.strictEqual(ASK_HISTORY_EXCEL, '需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel')
  assert.ok(formatDeleteOldTracking('95936').indexOf(DELETE_OLD_TRACKING.split('\n')[0]) === 0)
  assert.ok(D_FAIL_CHOICE.indexOf('请选择下一步（回复 1 或 2）') === 0)
})

test('accept fail>0 asks D_CHOOSE_REPAIR with D_FAIL_CHOICE', () => {
  const fixture = baseFixture('d-fail-choice', {
    events: [{ evtId: '8001', eventName: 'Ready' }],
    implEvents: [{
      evtId: '8001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
    }],
    workflow: {
      version: 1,
      stages: {
        B: { status: 'done', completedAt: '2026-09-03T00:00:00.000Z' },
        C: { status: 'done', completedAt: '2026-09-03T00:01:00.000Z' }
      },
      history: []
    },
    acceptReport: {
      planOnly: false,
      summary: { total: 1, pass: 0, fail: 1, skip: 0, pathBlockerSkip: 0 }
    }
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).id, 'D_CHOOSE_REPAIR')
  assert.strictEqual(getNextTask(status).prompt, D_FAIL_CHOICE)
})

test('SKILL.md stays a short router without prompt copies', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../../SKILL.md'), 'utf8')
  const lines = skill.split(/\r?\n/).length
  assert.ok(lines <= 120, `SKILL.md has ${lines} lines`)
  ;[
    '请选择本次入口',
    '请选择 Playwright 打开方式',
    '请选择下一步（回复 1 或 2）',
    '检测到旧埋点将被删除',
    '需要梳理哪个历史埋点文档的数据'
  ].forEach(banned => {
    assert.ok(skill.indexOf(banned) === -1, banned)
  })
})

const { applyPatch } = require('./apply-impl-patch')
const { assertCurrentTask, TASK_MISMATCH_EXIT } = require('./assert-task')
const { formatStageReport } = require('./format-stage-report')
const { FULL_PAGE_PROMPT } = require('./prompts')

function analyzedEvent(evtId) {
  return {
    evtId,
    status: 'existing',
    targetFile: 'src/foo.js',
    functionName: 'handleShare',
    lifecycle: 'onClick',
    parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
  }
}

test('CHOOSE_ENTRY rejects apply-impl-patch and leaves impl unchanged', () => {
  const fixture = baseFixture('gate-no-entry', {
    events: [{ evtId: '1', eventName: 'Pending' }],
    implEvents: [{ evtId: '1', status: 'pending', targetFile: '', parameters: [] }]
  })
  const before = fs.readFileSync(fixture.paths.implPath, 'utf8')
  const result = applyPatch(fixture.paths, {
    excel: fixture.excelPath,
    task: 'A_ANALYZE_EVENT',
    evt: '1'
  }, fixture.root, {
    evtId: '1',
    status: 'located',
    targetFile: 'src/foo.js',
    functionName: 'fn',
    lifecycle: 'onClick',
    parameters: [{ key: 'roomId', expression: 'x', confidence: 'high' }]
  })
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.exitCode, TASK_MISMATCH_EXIT)
  assert.strictEqual(result.actual, 'CHOOSE_ENTRY')
  assert.strictEqual(fs.readFileSync(fixture.paths.implPath, 'utf8'), before)
})

test('wrong evtId patch is rejected and first event stays pending', () => {
  const fixture = baseFixture('gate-wrong-evt', {
    events: [
      { evtId: '1', eventName: 'First' },
      { evtId: '2', eventName: 'Second' }
    ],
    implEvents: [
      { evtId: '1', status: 'pending', targetFile: '', parameters: [] },
      { evtId: '2', status: 'pending', targetFile: '', parameters: [] }
    ]
  })
  const result = applyPatch(fixture.paths, entered(fixture, { task: 'A_ANALYZE_EVENT', evt: '2' }), fixture.root, {
    evtId: '2',
    status: 'located',
    targetFile: 'src/foo.js',
    functionName: 'fn',
    lifecycle: 'onClick',
    parameters: [{ key: 'roomId', expression: 'x', confidence: 'high' }]
  })
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.exitCode, TASK_MISMATCH_EXIT)
  const impl = readJson(fixture.paths.implPath, { events: [] })
  assert.strictEqual(impl.events.find(item => item.evtId === '1').status, 'pending')
  assert.strictEqual(impl.events.find(item => item.evtId === '2').status, 'pending')
})

test('apply one analyzed event leaves nextTask on the second A_ANALYZE_EVENT', () => {
  const fixture = baseFixture('single-evt-done', {
    events: [
      { evtId: '1', eventName: 'First' },
      { evtId: '2', eventName: 'Second' }
    ],
    implEvents: [
      { evtId: '1', status: 'pending', targetFile: '', parameters: [] },
      { evtId: '2', status: 'pending', targetFile: '', parameters: [] }
    ]
  })
  const result = applyPatch(fixture.paths, entered(fixture, { task: 'A_ANALYZE_EVENT', evt: '1' }), fixture.root, {
    evtId: '1',
    status: 'located',
    targetFile: 'src/foo.js',
    functionName: 'fn',
    lifecycle: 'onClick',
    parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
  })
  assert.strictEqual(result.ok, true)
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.A.done, false)
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
  assert.strictEqual(getNextTask(status).subject.evtId, '2')
})

test('--mark=C is rejected while A still pending', () => {
  const fixture = baseFixture('mark-c-denied', {
    events: [{ evtId: '1', eventName: 'Pending' }],
    implEvents: [{ evtId: '1', status: 'pending', targetFile: '', parameters: [] }]
  })
  const denied = refuseAgentMark('C')
  assert.strictEqual(denied.exitCode, 20)
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(status.stageStatus.A.done, false)
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
})

test('needsConfirm blocks D_RUN_ACCEPT assert', () => {
  const fixture = baseFixture('no-d-while-b', {
    events: [{ evtId: '3001', eventName: 'Need confirm' }],
    implEvents: [{
      evtId: '3001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: '', confidence: 'medium' }]
    }]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  const gate = assertCurrentTask(status, 'D_RUN_ACCEPT')
  assert.strictEqual(gate.ok, false)
  assert.strictEqual(gate.exitCode, TASK_MISMATCH_EXIT)
  assert.strictEqual(gate.actual, 'B_CONFIRM_EVENT')
})

test('D_CHOOSE_DEVICE blocks real accept assert', () => {
  const fixture = baseFixture('no-device-accept', {
    events: [{ evtId: '8001', eventName: 'Ready' }],
    implEvents: [analyzedEvent('8001')],
    workflow: {
      version: 1,
      stages: {
        B: { status: 'done', completedAt: '2026-09-03T00:00:00.000Z' },
        C: { status: 'done', completedAt: '2026-09-03T00:01:00.000Z' }
      },
      history: []
    }
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).id, 'D_CHOOSE_DEVICE')
  const gate = assertCurrentTask(status, 'D_RUN_ACCEPT')
  assert.strictEqual(gate.ok, false)
  assert.strictEqual(gate.actual, 'D_CHOOSE_DEVICE')
})

test('--mark=B is rejected; nextTask stays B_CONFIRM_FULL_PAGE', () => {
  const fixture = baseFixture('mark-b-denied', {
    events: [{ evtId: '5001', eventName: 'Ready for C' }],
    implEvents: [analyzedEvent('5001')]
  })
  const denied = refuseAgentMark('B')
  assert.strictEqual(denied.exitCode, 20)
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).id, 'B_CONFIRM_FULL_PAGE')
})

test('B done without C mark starts C_WRITE_EVENT', () => {
  const fixture = baseFixture('c-write-event', {
    events: [{ evtId: '5001', eventName: 'Ready for C' }],
    implEvents: [analyzedEvent('5001')],
    workflow: {
      version: 1,
      stages: { B: { status: 'done', completedAt: '2026-09-03T00:00:00.000Z' } },
      history: []
    }
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  assert.strictEqual(getNextTask(status).id, 'C_WRITE_EVENT')
  assert.strictEqual(getNextTask(status).subject.evtId, '5001')
})

test('stage report for full-page confirm is script-fixed', () => {
  const fixture = baseFixture('stage-report', {
    events: [{ evtId: '5001', eventName: 'Ready for C' }],
    implEvents: [analyzedEvent('5001')]
  })
  const status = buildStatus(fixture.paths, entered(fixture), fixture.root)
  const report = formatStageReport(status, readJson(fixture.paths.implPath), {})
  assert.ok(report.indexOf('5001') !== -1)
  assert.ok(report.indexOf(FULL_PAGE_PROMPT) !== -1)
  assert.ok(report.indexOf('== 路径 A ==') !== -1)
})

