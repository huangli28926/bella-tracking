const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { defaultAcceptPaths } = require('../accept/accept-chain')
const { buildStatus, gateStage, loadState, runStage, workflowPath } = require('./tracking-workflow')
const { DEVICE_PROMPT } = require('../accept/accept-device')
const { readJson, writeJson } = require('../lib/lib')

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

test('same disk facts resolve to the same nextTask', () => {
  const fixture = baseFixture('determinism', {
    events: [{ evtId: '1001', eventName: 'Pending event' }],
    implEvents: [{ evtId: '1001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const first = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  const second = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.deepStrictEqual(getNextTask(first), getNextTask(second))
  assert.strictEqual(getNextTask(first).id, 'A_ANALYZE_EVENT')
  assert.strictEqual(first.stageStatus.A.done, false)
})

test('dump/render done does not imply A complete when impl facts are missing', () => {
  const fixture = baseFixture('a-partial', {
    events: [{ evtId: '2001', eventName: 'Analyze me' }],
    implEvents: [{ evtId: '2001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(status.stageStatus.D.done, true)
  assert.strictEqual(status.nextTask, null)
})

test('same facts twice keep nextTask including command and prompt', () => {
  const fixture = baseFixture('stable-cmd', {
    events: [{ evtId: '1001', eventName: 'Pending event' }],
    implEvents: [{ evtId: '1001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const first = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  const second = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.deepStrictEqual(getNextTask(first), getNextTask(second))
  assert.strictEqual(getNextTask(first).id, 'A_ANALYZE_EVENT')
  assert.strictEqual(getNextTask(first).executor, 'agent')
  assert.strictEqual(getNextTask(first).subject.evtId, '1001')
  assert.match(getNextTask(first).command, /^node scripts\/workflow\/tracking-workflow\.js --excel=docs\/stable-cmd\.xlsx --status --json$/)
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
  const first = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  const second = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(getNextTask(status).stage, 'A')
  assert.notStrictEqual(getNextTask(status).id, 'C_WRITE_IMPL')
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
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
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(status.stageStatus.A.done, true)
  assert.notStrictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
})

